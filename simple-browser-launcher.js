#!/usr/bin/env node

// Simple cross-platform browser launcher for FactorFlux
const { spawn, exec } = require('child_process');
const os = require('os');

const FACTORFLUX_URL = 'https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev';

console.log('🚀 Starting FactorFlux Desktop...');
console.log('📱 Opening in your default web browser...');
console.log('');

function openBrowser(url) {
    const platform = os.platform();
    let command;

    switch (platform) {
        case 'darwin': // macOS
            command = `open "${url}"`;
            break;
        case 'win32': // Windows
            command = `start "" "${url}"`;
            break;
        default: // Linux and others
            command = `xdg-open "${url}"`;
            break;
    }

    exec(command, (error) => {
        if (error) {
            console.log('❌ Could not automatically open browser.');
            console.log('📋 Please manually open this URL in your browser:');
            console.log('🔗', url);
        } else {
            console.log('✅ FactorFlux is now running in your browser!');
            console.log('💡 You can bookmark this URL for easy access:');
            console.log('🔗', url);
        }
        
        console.log('');
        console.log('📱 To create a desktop app experience:');
        
        if (platform === 'darwin') {
            console.log('   • Safari: Share > Add to Dock');
            console.log('   • Chrome: More Tools > Create Shortcut > Open as Window');
        } else if (platform === 'win32') {
            console.log('   • Chrome: More Tools > Create Shortcut > Open as Window');
            console.log('   • Edge: Apps > Install this site as an app');
        } else {
            console.log('   • Chrome: More Tools > Create Shortcut > Open as Window');
            console.log('   • Firefox: Right-click > Create Desktop Shortcut');
        }
        
        console.log('');
        console.log('👋 You can close this window now.');
        
        // Keep window open for a few seconds so user can read the message
        setTimeout(() => {
            process.exit(0);
        }, 10000);
    });
}

openBrowser(FACTORFLUX_URL);