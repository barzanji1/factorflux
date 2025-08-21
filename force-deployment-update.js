// Force deployment update by checking if our latest code is actually deployed
async function checkDeploymentStatus() {
  try {
    console.log('=== Deployment Status Check ===');
    
    // Check if our version endpoint exists
    console.log('Testing version endpoint...');
    try {
      const response = await fetch('https://qcoretpf.com/api/version-check');
      const text = await response.text();
      console.log('Version endpoint response type:', response.headers.get('content-type'));
      console.log('Version response (first 200 chars):', text.substring(0, 200));
      
      if (text.includes('v2.0.0-FORCE-UPDATE')) {
        console.log('✅ Latest code IS deployed');
      } else {
        console.log('❌ Latest code NOT deployed - still serving old version');
      }
    } catch (versionError) {
      console.log('❌ Version endpoint not accessible:', versionError.message);
    }
    
    // Check authentication endpoint
    console.log('\nTesting auth endpoint...');
    try {
      const authResponse = await fetch('https://qcoretpf.com/api/auth/local/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test', password: 'test' })
      });
      
      const authText = await authResponse.text();
      console.log('Auth endpoint response type:', authResponse.headers.get('content-type'));
      console.log('Auth response (first 100 chars):', authText.substring(0, 100));
      
      if (authText.includes('Invalid email or password')) {
        console.log('✅ Auth endpoint IS working (returns JSON error)');
      } else if (authText.includes('<!DOCTYPE html>')) {
        console.log('❌ Auth endpoint NOT working (returns HTML)');
      }
    } catch (authError) {
      console.log('❌ Auth endpoint error:', authError.message);
    }
    
  } catch (error) {
    console.error('Deployment check failed:', error);
  }
}

checkDeploymentStatus();