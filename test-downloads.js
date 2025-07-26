#!/usr/bin/env node

// Test script to verify download endpoints work
const http = require('http');
const https = require('https');

const endpoints = [
  'http://localhost:5000/api/desktop/download/windows',
  'http://localhost:5000/api/desktop/download/mac', 
  'http://localhost:5000/api/desktop/download/linux',
  'http://localhost:5000/api/desktop/download/guide'
];

console.log('Testing download endpoints...\n');

endpoints.forEach((url, index) => {
  const client = url.startsWith('https') ? https : http;
  
  const req = client.request(url, { method: 'HEAD' }, (res) => {
    console.log(`${index + 1}. ${url}`);
    console.log(`   Status: ${res.statusCode}`);
    console.log(`   Content-Type: ${res.headers['content-type']}`);
    console.log(`   Content-Length: ${res.headers['content-length']}`);
    console.log('');
  });
  
  req.on('error', (err) => {
    console.log(`${index + 1}. ${url}`);
    console.log(`   ERROR: ${err.message}`);
    console.log('');
  });
  
  req.end();
});