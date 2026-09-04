const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Setup multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.lua')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file .lua yang diizinkan!'));
        }
    }
});

// Store scripts in memory (production should use database)
const scripts = new Map();
const users = new Map();

// Admin credentials (change this!)
const ADMIN_USER = 'kinglua';
const ADMIN_PASS = bcrypt.hashSync('KingLua2026!', 10);

// JWT Secret
const JWT_SECRET = 'KingLuaSuperSecretKey2026!';

// Middleware auth
const auth = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// ====== OBFUSCATOR ENGINE ======
function obfuscateLua(code) {
    // Remove comments
    code = code.replace(/--.*$/gm, '');
    
    // Variable renaming
    let varMap = new Map();
    let varCounter = 0;
    const varRegex = /(local\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
    const keywords = ['if', 'then', 'else', 'elseif', 'end', 'for', 'do', 'while', 'repeat', 'until', 'function', 'return', 'break', 'local', 'nil', 'true', 'false', 'and', 'or', 'not', 'in', 'goto'];
    
    code = code.replace(varRegex, (match, local, varName) => {
        if (keywords.includes(varName) || varName.startsWith('_')) return match;
        if (!varMap.has(varName)) {
            varMap.set(varName, '_' + varCounter.toString(36).toUpperCase());
            varCounter++;
        }
        return (local || '') + varMap.get(varName) + ' =';
    });
    
    // Replace variable usage
    varMap.forEach((newName, oldName) => {
        const regex = new RegExp('\\b' + oldName + '\\b', 'g');
        code = code.replace(regex, newName);
    });
    
    // String encoding
    code = code.replace(/'([^']*)'/g, (match, str) => {
        let encoded = '';
        for (let i = 0; i < str.length; i++) {
            encoded += '\\' + str.charCodeAt(i).toString(8);
        }
        return "'" + encoded + "'";
    });
    
    code = code.replace(/"([^"]*)"/g, (match, str) => {
        let encoded = '';
        for (let i = 0; i < str.length; i++) {
            encoded += '\\' + str.charCodeAt(i).toString(8);
        }
        return '"' + encoded + '"';
    });
    
    // Add garbage code
    const garbage = [
        'local _=...;local __=...;local ___=...',
        'local ____=function() return ... end',
        'local _____={...};local ______=...',
    ];
    const randomGarbage = garbage[Math.floor(Math.random() * garbage.length)];
    code = randomGarbage + '\n' + code;
    
    // Base64 encode with Xor
    const encoded = Buffer.from(code).toString('base64');
    const xorKey = Math.floor(Math.random() * 255);
    let xorEncoded = '';
    for (let i = 0; i < encoded.length; i++) {
        xorEncoded += String.fromCharCode(encoded.charCodeAt(i) ^ xorKey);
    }
    
    // Final wrapper
    return `-- KingLua Obfuscator v1.0\n-- Protected by KingLua\nlocal _=${xorKey};local __=...;local ___=...\nlocal ____=function(...)local ___={...};local _=string.char;local __=string.byte;local _____=...;local ______=...;local _______='${Buffer.from(xorEncoded).toString('base64')}';local ________='';for i=1,#_______ do ________=________.._(__(_______,""..i)~_);end;loadstring(________)()end;____()`;
}

// ====== ROUTES ======

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && bcrypt.compareSync(password, ADMIN_PASS)) {
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, username });
    } else {
        res.status(401).json({ error: 'Username atau password salah!' });
    }
});

// Upload & obfuscate
app.post('/api/obfuscate', auth, upload.single('file'), async (req, res) => {
    try {
        let code = req.body.code || '';
        
        // If file uploaded
        if (req.file) {
            code = req.file.buffer.toString('utf8');
        }
        
        if (!code || code.trim() === '') {
            return res.status(400).json({ error: 'Tidak ada kode Lua yang diupload!' });
        }
        
        // Obfuscate
        const obfuscated = obfuscateLua(code);
        
        // Save with unique ID
        const id = uuidv4();
        scripts.set(id, {
            original: code,
            obfuscated: obfuscated,
            userId: req.user.username,
            createdAt: new Date().toISOString()
        });
        
        res.json({
            id: id,
            obfuscated: obfuscated,
            message: '✅ Script berhasil di-obfuscate!'
        });
        
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get obfuscated script (only owner can see)
app.get('/api/script/:id', auth, (req, res) => {
    const script = scripts.get(req.params.id);
    if (!script) {
        return res.status(404).json({ error: 'Script tidak ditemukan!' });
    }
    
    if (script.userId !== req.user.username) {
        return res.status(403).json({ error: 'Anda tidak memiliki akses ke script ini!' });
    }
    
    res.json({
        original: script.original,
        obfuscated: script.obfuscated,
        createdAt: script.createdAt
    });
});

// Get user scripts
app.get('/api/my-scripts', auth, (req, res) => {
    const userScripts = [];
    scripts.forEach((script, id) => {
        if (script.userId === req.user.username) {
            userScripts.push({
                id,
                createdAt: script.createdAt
            });
        }
    });
    res.json(userScripts);
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`👑 KingLua Server running on port ${PORT}`);
});
