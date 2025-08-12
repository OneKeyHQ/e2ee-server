const http = require('http');

const testEndpoints = async () => {
  const userId = 'test-user-1';
  const baseUrl = 'http://localhost:7001';

  // Test GET /sync/lock
  console.log('\n📍 Testing GET /sync/lock');
  await makeRequest('GET', `/sync/lock?userId=${userId}`);

  // Test POST /sync/lock
  console.log('\n📍 Testing POST /sync/lock');
  await makeRequest('POST', `/sync/lock?userId=${userId}`, {
    pwdHash: 'test-hash-123',
    lock: {
      encryptedPassword: 'encrypted-pwd',
      salt: 'salt-123',
    },
  });

  // Test POST /sync/check
  console.log('\n📍 Testing POST /sync/check');
  await makeRequest('POST', `/sync/check?userId=${userId}`, {
    pwdHash: 'test-hash-123',
    localData: [],
    onlyCheckLocalDataType: [],
  });

  // Test POST /sync/download
  console.log('\n📍 Testing POST /sync/download');
  await makeRequest('POST', `/sync/download?userId=${userId}`, {
    pwdHash: 'test-hash-123',
    skip: 0,
    limit: 10,
  });

  // Test POST /sync/upload
  console.log('\n📍 Testing POST /sync/upload');
  await makeRequest('POST', `/sync/upload?userId=${userId}`, {
    pwdHash: 'test-hash-123',
    localData: [
      {
        key: 'test-key-1',
        dataType: 'settings',
        data: { test: 'data' },
        dataTimestamp: Date.now(),
        isDeleted: false,
      },
    ],
  });

  // Test POST /sync/flush
  console.log('\n📍 Testing POST /sync/flush');
  await makeRequest('POST', `/sync/flush?userId=${userId}`, {
    pwdHash: 'new-hash-456',
    localData: [],
    lock: {
      encryptedPassword: 'new-encrypted-pwd',
      salt: 'new-salt-456',
    },
  });
};

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 7001,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`Response Status: ${res.statusCode}`);
        try {
          const parsed = JSON.parse(data);
          console.log('Response:', JSON.stringify(parsed, null, 2));
        } catch (e) {
          console.log('Response:', data);
        }
        resolve();
      });
    });

    req.on('error', (error) => {
      console.error('Request failed:', error);
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Run tests
console.log('🚀 Testing Sync Mock App Endpoints...');
testEndpoints()
  .then(() => console.log('\n✅ All tests completed'))
  .catch((err) => console.error('\n❌ Test failed:', err));