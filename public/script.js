const socket = io();

let currentUsername = '';
let typingTimeout = null;
let autoTranslate = true; // 默认开启自动翻译

// DOM 元素
const loginModal = document.getElementById('loginModal');
const chatContainer = document.getElementById('chatContainer');
const usernameInput = document.getElementById('usernameInput');
const joinBtn = document.getElementById('joinBtn');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messages = document.getElementById('messages');
const userList = document.getElementById('userList');
const userCount = document.getElementById('userCount');
const typingIndicator = document.getElementById('typingIndicator');
const translateToggle = document.getElementById('translateToggle');
const translateStatus = document.getElementById('translateStatus');

// 加入聊天室
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username) {
        currentUsername = username;
        socket.emit('join', username);
        loginModal.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        messageInput.focus();
    } else {
        alert('请输入您的昵称');
    }
});

// 回车键加入
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinBtn.click();
    }
});

// 发送消息
function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('message', { message });
        messageInput.value = '';
        socket.emit('typing', { isTyping: false });
    }
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    } else {
        socket.emit('typing', { isTyping: true });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('typing', { isTyping: false });
        }, 1000);
    }
});

// 语言检测函数
function detectLanguage(text) {
    if (!text || text.trim().length === 0) {
        return 'auto';
    }
    
    // 简单的语言检测：检查是否包含中文字符
    const chineseRegex = /[\u4e00-\u9fa5]/;
    const englishRegex = /[a-zA-Z]/;
    
    const hasChinese = chineseRegex.test(text);
    const hasEnglish = englishRegex.test(text);
    
    // 纯中文
    if (hasChinese && !hasEnglish) {
        return 'zh';
    }
    // 纯英文（至少3个字母才认为是英文）
    if (hasEnglish && !hasChinese) {
        const englishWords = text.match(/[a-zA-Z]+/g) || [];
        const totalEnglishChars = englishWords.join('').length;
        if (totalEnglishChars >= 3) {
            return 'en';
        }
    }
    // 中英文混合
    if (hasChinese && hasEnglish) {
        const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const englishCount = (text.match(/[a-zA-Z]/g) || []).length;
        return chineseCount >= englishCount ? 'zh' : 'en';
    }
    
    return 'auto';
}

// 翻译函数
async function translateText(text, from, to) {
    try {
        console.log('开始翻译:', { text, from, to });
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                from: from,
                to: to
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('翻译API错误:', response.status, errorData);
            throw new Error('翻译失败: ' + (errorData.error || response.statusText));
        }
        
        const data = await response.json();
        console.log('翻译结果:', data);
        return data.translatedText || data.translated;
    } catch (error) {
        console.error('翻译错误:', error);
        return null;
    }
}

// 接收消息
socket.on('message', async (data) => {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    if (data.username === currentUsername) {
        messageDiv.classList.add('own');
    }
    
    const time = new Date(data.timestamp).toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const originalMessage = escapeHtml(data.message);
    const detectedLang = detectLanguage(data.message);
    
    // 创建消息内容
    let messageContentHTML = `
        <div class="message-header">
            <span class="message-username">${escapeHtml(data.username)}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${originalMessage}</div>
    `;
    
    messageDiv.innerHTML = messageContentHTML;
    messages.appendChild(messageDiv);
    
    // 如果需要翻译且检测到语言
    if (autoTranslate && detectedLang !== 'auto') {
        const targetLang = detectedLang === 'zh' ? 'en' : 'zh';
        console.log('需要翻译:', { detectedLang, targetLang, message: data.message });
        
        // 添加翻译中提示
        const translationDiv = document.createElement('div');
        translationDiv.className = 'message-translation translating';
        translationDiv.textContent = '翻译中...';
        messageDiv.appendChild(translationDiv);
        
        // 执行翻译
        try {
            const translatedText = await translateText(data.message, detectedLang, targetLang);
            
            if (translatedText && translatedText.trim() && translatedText !== data.message.trim()) {
                translationDiv.classList.remove('translating');
                translationDiv.innerHTML = `<span style="opacity: 0.7;">${escapeHtml(translatedText)}</span>`;
            } else {
                translationDiv.remove();
            }
        } catch (error) {
            console.error('翻译处理错误:', error);
            translationDiv.remove();
        }
    } else {
        console.log('跳过翻译:', { autoTranslate, detectedLang });
    }
    
    scrollToBottom();
});

// 用户加入/离开
socket.on('userJoined', (data) => {
    addSystemMessage(data.message);
});

socket.on('userLeft', (data) => {
    addSystemMessage(data.message);
});

// 更新用户列表
socket.on('userList', (users) => {
    userList.innerHTML = '';
    userCount.textContent = users.length;
    
    users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = escapeHtml(user);
        userList.appendChild(li);
    });
});

// 正在输入提示
let typingUsers = new Set();
socket.on('typing', (data) => {
    if (data.isTyping) {
        typingUsers.add(data.username);
    } else {
        typingUsers.delete(data.username);
    }
    
    updateTypingIndicator();
});

function updateTypingIndicator() {
    if (typingUsers.size > 0) {
        const usersArray = Array.from(typingUsers);
        if (usersArray.length === 1) {
            typingIndicator.textContent = `${usersArray[0]} 正在输入...`;
        } else if (usersArray.length === 2) {
            typingIndicator.textContent = `${usersArray[0]} 和 ${usersArray[1]} 正在输入...`;
        } else {
            typingIndicator.textContent = `${usersArray[0]} 等 ${usersArray.length} 人正在输入...`;
        }
    } else {
        typingIndicator.textContent = '';
    }
}

// 添加系统消息
function addSystemMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system-message';
    messageDiv.textContent = message;
    messages.appendChild(messageDiv);
    scrollToBottom();
}

// 滚动到底部
function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 翻译开关
translateToggle.addEventListener('click', () => {
    autoTranslate = !autoTranslate;
    translateStatus.textContent = `自动翻译: ${autoTranslate ? '开启' : '关闭'}`;
    translateToggle.classList.toggle('active', autoTranslate);
    
    // 如果关闭翻译，移除所有翻译文本
    if (!autoTranslate) {
        document.querySelectorAll('.message-translation').forEach(el => el.remove());
    } else {
        // 如果开启翻译，重新翻译所有消息
        document.querySelectorAll('.message').forEach(async (messageDiv) => {
            const messageContent = messageDiv.querySelector('.message-content');
            if (messageContent && !messageDiv.querySelector('.message-translation')) {
                const text = messageContent.textContent;
                const detectedLang = detectLanguage(text);
                if (detectedLang !== 'auto') {
                    const targetLang = detectedLang === 'zh' ? 'en' : 'zh';
                    const translatedText = await translateText(text, detectedLang, targetLang);
                    if (translatedText && translatedText !== text) {
                        const translationDiv = document.createElement('div');
                        translationDiv.className = 'message-translation';
                        translationDiv.innerHTML = `<span style="opacity: 0.7;">${escapeHtml(translatedText)}</span>`;
                        messageDiv.appendChild(translationDiv);
                    }
                }
            }
        });
    }
});

// 初始化翻译开关状态
translateToggle.classList.add('active');

// 页面加载完成后聚焦输入框
window.addEventListener('load', () => {
    usernameInput.focus();
    initParticles();
});

// 粒子背景效果
function initParticles() {
    const canvas = document.getElementById('particles');
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const particleCount = 50;
    
    class Particle {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 3 + 1;
            this.speedX = Math.random() * 2 - 1;
            this.speedY = Math.random() * 2 - 1;
            this.opacity = Math.random() * 0.5 + 0.2;
        }
        
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            
            if (this.x > canvas.width || this.x < 0) this.speedX *= -1;
            if (this.y > canvas.height || this.y < 0) this.speedY *= -1;
        }
        
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(102, 126, 234, ${this.opacity})`;
            ctx.fill();
        }
    }
    
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        particles.forEach(particle => {
            particle.update();
            particle.draw();
        });
        
        // 绘制连线
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 150) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(102, 126, 234, ${0.2 * (1 - distance / 150)})`;
                    ctx.lineWidth = 1;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
        
        requestAnimationFrame(animate);
    }
    
    animate();
    
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

