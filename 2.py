# -*- coding: utf-8 -*-

# 注意：我们更换了 binance 库的导入，以适应异步环境
from binance import AsyncClient, BinanceSocketManager
import asyncio
from telegram import Bot
import sys
# 引入 nest_asyncio 解决 Jypyter/某些环境的循环问题，虽然在 screen 中不一定必要，但能增加兼容性
import nest_asyncio 
# 允许嵌套运行，以防万一
nest_asyncio.apply()

# ==========================================================
# --- 1. 配置参数 ---
# ==========================================================
SYMBOL = 'BTCUSDT'       # 交易对
INTERVAL = '15m'          # K线周期 ('1m', '5m', '15m' 等)
COUNT_THRESHOLD = 3      # 连续的次数阈值 (超过 3 次为涨/跌)

# --- Telegram 配置 (请务必替换为您自己的值) ---
TELEGRAM_BOT_TOKEN = "7981251378:AAGXKHEwBadMbOEZltN2mHUTpc2fAS9Yhf4"
TELEGRAM_CHAT_ID = 6033396937 
# ---------------------

# 用于存储最近 N 根 K 线收盘价的列表
closes_history = []
HISTORY_SIZE = COUNT_THRESHOLD + 1 

# ==========================================================
# --- 2. 警报发送函数 (原生异步) ---
# ==========================================================

async def send_telegram_message_async(message):
    """异步执行 Telegram 消息发送，直接在主事件循环中运行。"""
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    try:
        await bot.send_message(
            chat_id=TELEGRAM_CHAT_ID, 
            text=message, 
            parse_mode='Markdown'
        )
        print("Telegram 消息发送成功。")
    except Exception as e:
        print(f"Telegram 消息发送失败：{e}")

# 在新的异步结构中，send_alert 就不再需要是同步包装了，它只是一个打印和触发异步发送的函数
def print_alert_message(message):
    """仅用于打印警报信息，然后调用异步发送。"""
    print(f"\n==================================================")
    print(f"🚨 ALERT: {message}")
    print(f"==================================================\n")


# ==========================================================
# --- 3. 核心趋势检测逻辑 (保持不变) ---
# ==========================================================

def check_consecutive_trend(closes):
    """检查最近的 K 线收盘价是否满足连续上涨或下跌的条件。"""
    if len(closes) < HISTORY_SIZE:
        return None, 0

    consecutive_up = 0
    for i in range(1, len(closes)):
        if closes[-i] > closes[-(i+1)]:
            consecutive_up += 1
        else:
            break
            
    if consecutive_up >= COUNT_THRESHOLD:
        return "上涨", consecutive_up

    consecutive_down = 0
    for i in range(1, len(closes)):
        if closes[-i] < closes[-(i+1)]:
            consecutive_down += 1
        else:
            break

    if consecutive_down >= COUNT_THRESHOLD:
        return "下跌", consecutive_down

    return None, 0


# ==========================================================
# --- 4. WebSocket 数据处理 (异步回调) ---
# ==========================================================

async def handle_socket_message(msg):
    """异步处理接收到的 K 线数据更新。"""
    # 确保连接成功，并且是 K 线数据
    if 'e' in msg and msg['e'] == 'kline' and 'k' in msg:
        kline = msg['k']
        
        # 'x' == True 表示 K 线已关闭（最终确定）
        if kline['x']:
            close_price = float(kline['c'])
            print(f"🔔 {SYMBOL} {INTERVAL} K 线关闭。收盘价: {close_price}")
            
            # 更新历史记录
            global closes_history
            closes_history.append(close_price)
            if len(closes_history) > HISTORY_SIZE:
                closes_history = closes_history[1:]
            
            print(f"历史收盘价 ({len(closes_history)}/{HISTORY_SIZE}): {closes_history}")

            # 检查趋势
            trend, count = check_consecutive_trend(closes_history)

            if trend:
                message = (
                    f"*{SYMBOL} K线警报 - {INTERVAL}周期*"
                    f"\n\n🚨 连续 {count} 根K线收盘价 `{trend}`!"
                    f"\n*最新价:* `{close_price:.2f}` USDT"
                )
                
                # 1. 打印警报信息
                print_alert_message(message)
                
                # 2. 异步发送 Telegram 消息
                await send_telegram_message_async(message)
            else:
                print("趋势不满足警报条件。")


# ==========================================================
# --- 5. 主程序启动 (使用 AsyncClient) ---
# ==========================================================

async def run_websocket_listener():
    """启动异步 WebSocket 监听器。"""
    
    # 使用 AsyncClient，不需要 API Key/Secret 即可访问公共流
    # 如果您需要交易功能，这里需要传入 api_key 和 api_secret
    client = await AsyncClient.create()
    bm = BinanceSocketManager(client)

    # 订阅 K 线流
    kline_stream = bm.kline_socket(symbol=SYMBOL, interval=INTERVAL)

    print(f"✅ 正在监听币安 {SYMBOL} 的 {INTERVAL} K 线流...")
    
    async with kline_stream as ksm:
        while True:
            # 接收并等待下一条消息
            msg = await ksm.recv()
            await handle_socket_message(msg)


if __name__ == '__main__':
    # 启动前检查配置是否正确
    if TELEGRAM_BOT_TOKEN == '7981251378:AAGXKHEwBadMbOEZltN2mHUTpc2fAS9Yhf4' or TELEGRAM_CHAT_ID == 6033396937:
        print("\n==================================================")
        print("⚠️ 警告：请先在代码中替换您的 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID！")
        print("==================================================\n")

    try:
        # 使用 asyncio.run 运行主异步函数
        asyncio.run(run_websocket_listener())
    except KeyboardInterrupt:
        print("\n程序被用户中断 (Ctrl+C)，正在退出...")
    except Exception as e:
        print(f"程序运行错误: {e}")