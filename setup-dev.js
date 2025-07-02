const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Configurazione ambiente di sviluppo...');

// Crea directory per Node-RED development
const nodeRedDevDir = path.join(__dirname, '.node-red-dev');
if (!fs.existsSync(nodeRedDevDir)) {
    fs.mkdirSync(nodeRedDevDir, { recursive: true });
    console.log('✅ Creata directory .node-red-dev');
}

// Crea directory nodes
const nodesDir = path.join(nodeRedDevDir, 'node_modules', 'node-red-contrib-influxdb');
if (!fs.existsSync(nodesDir)) {
    fs.mkdirSync(nodesDir, { recursive: true });
}

// Crea symlink per sviluppo
try {
    // Rimuovi eventuali link precedenti
    if (fs.existsSync(nodesDir)) {
        fs.rmSync(nodesDir, { recursive: true, force: true });
    }
    
    // Crea symlink (Windows richiede privilegi admin per i symlink, usiamo junction)
    if (process.platform === 'win32') {
        execSync(`mklink /J "${nodesDir}" "${__dirname}"`, { stdio: 'inherit' });
    } else {
        fs.symlinkSync(__dirname, nodesDir);
    }
    console.log('✅ Symlink creato per sviluppo');
} catch (error) {
    console.log('⚠️  Impossibile creare symlink, copiando files...');
    // Fallback: copia i file necessari
    fs.copyFileSync(path.join(__dirname, 'package.json'), path.join(nodesDir, 'package.json'));
    fs.copyFileSync(path.join(__dirname, 'influxdb.js'), path.join(nodesDir, 'influxdb.js'));
    fs.copyFileSync(path.join(__dirname, 'influxdb.html'), path.join(nodesDir, 'influxdb.html'));
    
    // Copia locales
    const localesDir = path.join(nodesDir, 'locales');
    if (fs.existsSync(path.join(__dirname, 'locales'))) {
        fs.cpSync(path.join(__dirname, 'locales'), localesDir, { recursive: true });
    }
}

// Crea settings.js per Node-RED development
const settingsPath = path.join(nodeRedDevDir, 'settings.js');
const settingsContent = `
module.exports = {
    uiPort: process.env.PORT || 1880,
    mqttReconnectTime: 15000,
    serialReconnectTime: 15000,
    debugMaxLength: 1000,
    functionGlobalContext: {},
    exportGlobalContextKeys: false,
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },
    editorTheme: {
        projects: {
            enabled: false
        }
    },
    adminAuth: undefined
};
`;

fs.writeFileSync(settingsPath, settingsContent);
console.log('✅ Settings.js creato');

// Installa Node-RED se non presente
try {
    execSync('npm list node-red', { stdio: 'pipe' });
    console.log('✅ Node-RED già installato');
} catch {
    console.log('📦 Installazione Node-RED...');
    execSync('npm install node-red --save-dev', { stdio: 'inherit' });
    console.log('✅ Node-RED installato');
}

console.log('\n🎉 Setup completato!');
console.log('📍 Per avviare il debug:');
console.log('   1. Premi F5 in VS Code');
console.log('   2. Oppure vai su Run and Debug → "Debug Node-RED with InfluxDB nodes"');
console.log('   3. Node-RED sarà disponibile su http://localhost:1880');