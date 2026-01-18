const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 存储在线用户
const users = new Map();

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 翻译API端点
app.post('/api/translate', async (req, res) => {
  try {
    const { text, from, to } = req.body;
    
    console.log('翻译请求:', { text, from, to });
    
    if (!text) {
      return res.status(400).json({ error: '缺少文本参数' });
    }

    // 首先尝试使用MyMemory API（更稳定）
    try {
      const langPair = from === 'auto' ? `en|${to}` : `${from}|${to}`;
      const response = await axios.get('https://api.mymemory.translated.net/get', {
        params: {
          q: text,
          langpair: langPair
        },
        timeout: 5000
      });
      
      if (response.data && response.data.responseData && response.data.responseData.translatedText) {
        console.log('MyMemory翻译成功:', response.data.responseData.translatedText);
        return res.json({
          translatedText: response.data.responseData.translatedText,
          detectedLanguage: from || 'auto'
        });
      }
    } catch (memoryError) {
      console.log('MyMemory API失败，尝试LibreTranslate:', memoryError.message);
    }

    // 如果MyMemory失败，尝试LibreTranslate
    try {
      const response = await axios.post('https://libretranslate.de/translate', {
        q: text,
        source: from || 'auto',
        target: to || 'zh',
        format: 'text'
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      if (response.data && response.data.translatedText) {
        console.log('LibreTranslate翻译成功:', response.data.translatedText);
        return res.json({
          translatedText: response.data.translatedText,
          detectedLanguage: response.data.detectedLanguage || from
        });
      }
    } catch (libreError) {
      console.log('LibreTranslate API失败:', libreError.message);
    }

    // 如果都失败了，返回错误
    res.status(500).json({ error: '翻译服务暂时不可用，请稍后重试' });
  } catch (error) {
    console.error('翻译错误:', error.message);
    res.status(500).json({ error: '翻译服务错误: ' + error.message });
  }
});

// Socket.io 连接处理
io.on('connection', (socket) => {
  console.log('新用户连接:', socket.id);

  // 用户加入聊天室
  socket.on('join', (username) => {
    users.set(socket.id, username);
    socket.username = username;
    
    // 通知所有用户有新用户加入
    io.emit('userJoined', {
      username: username,
      message: `${username} 加入了聊天室`,
      timestamp: new Date().toISOString()
    });

    // 发送当前在线用户列表
    io.emit('userList', Array.from(users.values()));
    
    console.log(`${username} 加入了聊天室`);
  });

  // 处理消息
  socket.on('message', (data) => {
    const messageData = {
      username: socket.username || '匿名用户',
      message: data.message,
      timestamp: new Date().toISOString(),
      socketId: socket.id
    };
    
    // 广播消息给所有用户
    io.emit('message', messageData);
    console.log(`消息来自 ${messageData.username}: ${data.message}`);
  });

  // 处理用户正在输入
  socket.on('typing', (data) => {
    socket.broadcast.emit('typing', {
      username: socket.username || '匿名用户',
      isTyping: data.isTyping
    });
  });

  // 用户断开连接
  socket.on('disconnect', () => {
    const username = users.get(socket.id) || socket.username;
    if (username) {
      users.delete(socket.id);
      
      // 通知所有用户有用户离开
      io.emit('userLeft', {
        username: username,
        message: `${username} 离开了聊天室`,
        timestamp: new Date().toISOString()
      });

      // 更新在线用户列表
      io.emit('userList', Array.from(users.values()));
      
      console.log(`${username} 离开了聊天室`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

