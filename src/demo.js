// Demo mode: what the tenant would answer, and realistic results in Checkmarx One's
// /api/results shape, so the booth can rehearse (or keep running) without a tenant.
// Fusion results are shaped exactly as the real engine returns them (type "sast",
// queryId 0, a CWE title, a <Language>_<SEVERITY> group), see src/fusion.js.

const node = (fileName, line, name = '', method = '') => ({ fileName, line, column: 5, name, method });

export function demoScanOptions() {
  return {
    source: 'demo',
    tenant: 'demo',
    region: 'EU',
    engines: [
      { key: 'sast', label: 'SAST', default: true },
      { key: 'sca', label: 'SCA (open source)', default: true },
      { key: 'kics', label: 'IaC Security', default: true },
      { key: 'apisec', label: 'API Security', default: true },
      { key: 'containers', label: 'Container Security', default: false },
      { key: 'microengines', label: 'Secrets & repo health', default: true },
    ],
    fusion: { available: true, default: true },
    models: [
      { key: 'mythos-5.1', label: 'Mythos 5.1 — deepest reasoning', default: false },
      { key: 'opus-5.5', label: 'Opus 5.5 — best balance', default: true },
      { key: 'opus-5.0', label: 'Opus 5.0', default: false },
      { key: 'opus-4.7', label: 'Opus 4.7', default: false },
      { key: 'haiku-4.5', label: 'Haiku 4.5 — fastest', default: false },
    ],
    presets: [
      { key: 'ASA Premium', label: 'ASA Premium', default: true },
      { key: 'OWASP Top 10 2021', label: 'OWASP Top 10 2021', default: false },
      { key: 'High and Medium', label: 'High and Medium', default: false },
    ],
    extendedAnalysis: true,
  };
}

const fusion = (id, severity, cwe, title, language, description, nodes) => ({
  type: 'sast', id, similarityId: id, severity, state: 'TO_VERIFY', status: 'NEW', description: '',
  // What Fusion actually determined travels with the result as the finding's own words.
  fusionInsight: description,
  data: { queryId: 0, queryName: title, group: `${language}_${severity}`, languageName: language, nodes },
  vulnerabilityDetails: { cweId: cwe, compliances: ['OWASP Top 10 2021'] },
});

export function demoResults() {
  return [
    // --- Fusion-only findings: the logic and cross-file issues rules cannot describe ---
    fusion('fus-001', 'CRITICAL', 639, "Authorization Bypass Through User-Controlled Key", 'JavaScript',
      'The order lookup endpoint loads an order by the id in the URL and returns it without checking that the order belongs to the signed-in customer. Ownership is checked in the web controller for the list view but not in the API route that bypasses it.',
      [node('src/api/orders.js', 42, 'req.params.id', 'getOrder'), node('src/services/orderService.js', 18, 'findById', 'findById'), node('src/api/orders.js', 47, 'res.json', 'getOrder')]),
    fusion('fus-002', 'HIGH', 367, 'Time-of-check Time-of-use (TOCTOU) Race Condition', 'JavaScript',
      'Coupon redemption reads the coupon, checks it has not been used, and only then marks it used in a separate database write. Concurrent requests pass the check together, so a single-use coupon can be redeemed many times.',
      [node('src/services/couponService.js', 57, 'coupon.used', 'redeem'), node('src/services/couponService.js', 71, 'coupon.save', 'redeem')]),
    fusion('fus-003', 'HIGH', 640, 'Weak Password Recovery Mechanism for Forgotten Password', 'JavaScript',
      'The password reset token is verified for format and expiry, but never bound to the user it was issued for. A valid token for one account resets another account\'s password by changing the email parameter.',
      [node('src/auth/reset.js', 88, 'req.body.email', 'resetPassword'), node('src/auth/reset.js', 102, 'user.setPassword', 'resetPassword')]),
    fusion('fus-004', 'MEDIUM', 862, 'Missing Authorization', 'JavaScript',
      'The admin-only middleware is registered after the /admin/export route, so that route is served before the authorization check runs.',
      [node('src/app.js', 31, 'app.get', 'bootstrap'), node('src/app.js', 36, 'app.use(requireAdmin)', 'bootstrap')]),
    // Fusion finding that the deterministic SAST engine also found (corroboration)
    fusion('fus-005', 'HIGH', 89, "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')", 'JavaScript',
      'The search term from the query string is concatenated into the SQL statement executed in products.js.',
      [node('src/routes/search.js', 12, 'req.query.q', 'search'), node('src/db/products.js', 23, 'db.query', 'query')]),

    // --- Deterministic engines ---
    { type: 'sast', id: 'sast-001', similarityId: 's1', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'The application\'s search method receives user input from req.query.q, which is concatenated into an SQL statement executed at products.js line 24.',
      data: { queryId: 9225899202125908000, queryName: 'SQL_Injection', group: 'JavaScript_High_Risk', languageName: 'JavaScript', nodes: [node('src/routes/search.js', 12, 'q', 'search'), node('src/db/products.js', 24, 'query', 'query')] },
      vulnerabilityDetails: { cweId: 89 } },
    { type: 'sast', id: 'sast-002', similarityId: 's2', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'User input from req.body.comment is rendered into the HTML page without encoding.',
      data: { queryId: 9225899202125908001, queryName: 'Reflected_XSS_All_Clients', group: 'JavaScript_High_Risk', languageName: 'JavaScript', nodes: [node('src/views/review.js', 40, 'comment', 'render')] },
      vulnerabilityDetails: { cweId: 79 } },
    { type: 'sast', id: 'sast-003', similarityId: 's3', severity: 'MEDIUM', state: 'TO_VERIFY', status: 'NEW',
      description: 'The filename parameter is used to build a path passed to fs.readFile.',
      data: { queryId: 9225899202125908002, queryName: 'Path_Traversal', group: 'JavaScript_Medium_Threat', languageName: 'JavaScript', nodes: [node('src/routes/files.js', 15, 'filename', 'download')] },
      vulnerabilityDetails: { cweId: 22 } },
    { type: 'sast', id: 'sast-004', similarityId: 's4', severity: 'LOW', state: 'TO_VERIFY', status: 'NEW',
      description: 'crypto.createHash("md5") is used to hash user passwords.',
      data: { queryId: 9225899202125908003, queryName: 'Use_Of_Broken_Or_Risky_Cryptographic_Algorithm', group: 'JavaScript_Low_Visibility', languageName: 'JavaScript', nodes: [node('src/auth/hash.js', 7, 'createHash', 'hashPassword')] },
      vulnerabilityDetails: { cweId: 327 } },
    { type: 'sca', id: 'CVE-2024-29041', similarityId: 'c1', severity: 'MEDIUM', state: 'TO_VERIFY', status: 'NEW',
      description: 'Express.js open redirect in malformed URLs: versions prior to 4.19.2 allow an attacker to bypass allow-list checks when redirecting.',
      data: { packageIdentifier: 'Npm-express-4.17.1', recommendedVersion: '4.19.2' },
      vulnerabilityDetails: { cweId: 601, cveName: 'CVE-2024-29041', cvssScore: 6.1 } },
    { type: 'sca', id: 'CVE-2021-23337', similarityId: 'c2', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'Lodash versions prior to 4.17.21 are vulnerable to command injection via the template function.',
      data: { packageIdentifier: 'Npm-lodash-4.17.15', recommendedVersion: '4.17.21' },
      vulnerabilityDetails: { cweId: 94, cveName: 'CVE-2021-23337', cvssScore: 7.2 } },
    { type: 'kics', id: 'kics-001', similarityId: 'k1', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'S3 bucket allows public read access.',
      data: { queryName: 'S3 Bucket ACL Allows Read Access To All Users', platform: 'Terraform', filename: 'infra/storage.tf', line: 12, expectedValue: "acl should be 'private'", actualValue: "acl is 'public-read'" } },
    { type: 'kics', id: 'kics-002', similarityId: 'k2', severity: 'MEDIUM', state: 'TO_VERIFY', status: 'NEW',
      description: 'Container runs as root user.',
      data: { queryName: 'Container Running As Root', platform: 'Dockerfile', filename: 'Dockerfile', line: 1, expectedValue: 'USER instruction with a non-root user', actualValue: 'No USER instruction' } },
    { type: 'sscs-secret-detection', id: 'sec-001', similarityId: 'x1', severity: 'HIGH', state: 'TO_VERIFY', status: 'NEW',
      description: 'An AWS access key was found committed in a configuration file.',
      data: { ruleName: 'AWS Access Key', filename: 'config/default.json', line: 9 },
      vulnerabilityDetails: { cweId: 798 } },
  ];
}

/** What Fusion's correlation returns for the demo scan: risk changes and the application map. */
export function demoFusion(scanId) {
  return {
    riskScores: [
      { resultId: 'fus-001', fusionScanId: 'fusion-demo', vulnerabilityEngine: 'SAST', correlatedEngine: 'KICS', oldRiskValue: 7.5, newRiskValue: 9.6, scanId, resultInfo: 'The orders API is reachable from the internet through the public ALB defined in infra/network.tf and reads from the customer-data bucket, so an authorization bypass here exposes every customer\'s orders.' },
      { resultId: 'sast-001', fusionScanId: 'fusion-demo', vulnerabilityEngine: 'SAST', correlatedEngine: 'SCA', oldRiskValue: 7.1, newRiskValue: 8.9, scanId, resultInfo: 'The vulnerable query runs through the lodash 4.17.15 template helper (CVE-2021-23337), which is on the same request path: the two combine into a remote code execution chain.' },
      { resultId: 'CVE-2024-29041', fusionScanId: 'fusion-demo', vulnerabilityEngine: 'SCA', correlatedEngine: 'SAST', oldRiskValue: 6.1, newRiskValue: 3.2, scanId, resultInfo: 'The vulnerable redirect function in express 4.17.1 is never called from this code base: no exploitable path was found, so the risk was lowered.' },
      { resultId: 'kics-001', fusionScanId: 'fusion-demo', vulnerabilityEngine: 'KICS', correlatedEngine: 'SAST', oldRiskValue: 6.8, newRiskValue: 9.1, scanId, resultInfo: 'The public S3 bucket is the one src/services/exportService.js writes customer exports to, so the misconfiguration exposes personal data, not just static assets.' },
    ],
    map: {
      summary: { microservices: { count: 3, language: { JavaScript: 3 }, actions: { read: 5, write: 4 } }, cloudResources: { count: 4, type: { 'AWS::S3::Bucket': 2, 'AWS::SQS::Queue': 1, 'AWS::RDS::DBInstance': 1 }, access: { Public: 1, Private: 3 }, category: { Storage: 2, Queue: 1, Database: 1 } } },
      resources: [
        { name: 'customer-exports', type: 'AWS::S3::Bucket', category: 'Storage', access: 'Public', filename: 'infra/storage.tf', actions: ['read', 'write'] },
        { name: 'assets', type: 'AWS::S3::Bucket', category: 'Storage', access: 'Private', filename: 'infra/storage.tf', actions: ['read'] },
        { name: 'order-events', type: 'AWS::SQS::Queue', category: 'Queue', access: 'Private', filename: 'infra/queue.tf', actions: ['write'] },
        { name: 'shop-db', type: 'AWS::RDS::DBInstance', category: 'Database', access: 'Private', filename: 'infra/db.tf', actions: ['read', 'write'] },
      ],
      microservices: [
        { projectId: 'orders-api', language: 'JavaScript', resources: [{ name: 'shop-db', type: 'AWS::RDS::DBInstance' }, { name: 'order-events', type: 'AWS::SQS::Queue' }] },
        { projectId: 'export-worker', language: 'JavaScript', resources: [{ name: 'customer-exports', type: 'AWS::S3::Bucket' }, { name: 'shop-db', type: 'AWS::RDS::DBInstance' }] },
        { projectId: 'storefront', language: 'JavaScript', resources: [{ name: 'assets', type: 'AWS::S3::Bucket' }] },
      ],
    },
  };
}
