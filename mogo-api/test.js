const http = require('http');

const data = JSON.stringify({ firstName: 'John', lastName: 'Doe', domain: 'apollo.io' });
const opts = {
  hostname: 'localhost', port: 7823, path: '/find', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
};
const req = http.request(opts, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    const result = JSON.parse(body);
    console.log('Primary email:', result.email);
    console.log('All patterns:', result.emails.join(', '));
    console.log('Confidence:', result.confidence);
  });
});
req.write(data);
req.end();
