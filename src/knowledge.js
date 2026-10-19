// Plain-language explanations used when Claude is not configured, and as the
// starting point Claude refines. Matched on CWE first, then on keywords.

const KB = [
  {
    key: 'sqli', cwes: ['89'], words: ['sql injection', 'sql_injection', 'sqli'],
    whatItMeans: 'User input reaches a database query without being safely separated from the query itself, so an attacker can rewrite the query.',
    businessImpact: 'An attacker could read, change or delete customer data in the database — a typical cause of reportable data breaches.',
    howToFix: 'Use parameterised queries / prepared statements or the ORM\'s binding API; never build SQL by concatenating strings.',
  },
  {
    key: 'xss', cwes: ['79', '80'], words: ['xss', 'cross site scripting', 'cross-site scripting'],
    whatItMeans: 'Untrusted input is written into a web page without being encoded, so an attacker can run their own script in a victim\'s browser.',
    businessImpact: 'Attackers can hijack user sessions, steal credentials or act as the user — damaging customer trust.',
    howToFix: 'Encode output for its context (HTML, attribute, JS), use the framework\'s auto-escaping, and add a Content-Security-Policy.',
  },
  {
    key: 'cmdi', cwes: ['77', '78'], words: ['command injection', 'os command', 'command_injection'],
    whatItMeans: 'User input is passed to an operating-system command, letting an attacker run commands on the server.',
    businessImpact: 'Full server takeover is possible: data theft, ransomware or using the server to attack others.',
    howToFix: 'Avoid shell calls; use library APIs, pass arguments as arrays, and strictly allow-list any input that must reach a command.',
  },
  {
    key: 'path', cwes: ['22', '23', '36', '73'], words: ['path traversal', 'directory traversal', 'file inclusion'],
    whatItMeans: 'A file path is built from user input, so an attacker can use "../" tricks to read or write files outside the intended folder.',
    businessImpact: 'Configuration files, keys or other customers\' files could be exposed or overwritten.',
    howToFix: 'Resolve the path and verify it stays inside an allowed base directory; prefer IDs mapped to files over raw names.',
  },
  {
    key: 'ssrf', cwes: ['918'], words: ['ssrf', 'server side request forgery', 'server-side request forgery'],
    whatItMeans: 'The server fetches a URL that the user controls, so an attacker can make it call internal systems.',
    businessImpact: 'Attackers can reach internal services or cloud metadata endpoints and steal cloud credentials.',
    howToFix: 'Allow-list destination hosts, block internal/link-local ranges, and do not return raw responses to the user.',
  },
  {
    key: 'deser', cwes: ['502'], words: ['deserialization', 'deserialisation', 'unsafe deserial'],
    whatItMeans: 'The application rebuilds objects from untrusted data, which can be crafted to execute code.',
    businessImpact: 'Can lead to remote code execution and full compromise of the application.',
    howToFix: 'Never deserialise untrusted data with native serializers; use simple data formats (JSON) with schema validation.',
  },
  {
    key: 'authz', whyMissed: 'Whether a check is missing depends on the application\'s intent and on how routes, services and middleware fit together — there is no single "bad" line of code for a rule to match.', cwes: ['284', '285', '639', '862', '863', '269'], words: ['authorization', 'access control', 'idor', 'privilege', 'missing auth', 'broken access'],
    whatItMeans: 'The code does not properly check whether the current user is allowed to perform an action or see a record.',
    businessImpact: 'Users could see or change other customers\' data — a business-logic flaw that scanners relying on patterns often miss.',
    howToFix: 'Enforce authorisation on the server for every request and object; check ownership, not just login state.',
  },
  {
    key: 'authn', whyMissed: 'The individual calls look correct; the flaw is in what the flow fails to verify end to end, which only shows up when the logic is reasoned about as a whole.', cwes: ['287', '306', '307', '384', '613', '620', '640'], words: ['password reset', 'authentication', 'session fixation', 'brute force', 'jwt'],
    whatItMeans: 'The way users prove who they are can be bypassed or abused.',
    businessImpact: 'Account takeover — attackers act as legitimate users, including administrators.',
    howToFix: 'Use a vetted authentication framework, validate tokens fully (signature, expiry, audience), rate-limit logins and rotate sessions.',
  },
  {
    key: 'secrets', cwes: ['798', '259', '321', '540', '312'], words: ['hardcoded', 'hard-coded', 'secret', 'password in', 'api key', 'credential', 'private key', 'token'],
    whatItMeans: 'A password, key or token is stored directly in the source code or configuration.',
    businessImpact: 'Anyone with access to the code (or a leaked copy) can use these credentials to access systems or cloud accounts.',
    howToFix: 'Revoke and rotate the credential now, move it to a secrets manager or environment variable, and add pre-commit secret scanning.',
  },
  {
    key: 'crypto', cwes: ['326', '327', '328', '330', '338', '916', '759', '760'], words: ['weak crypto', 'md5', 'sha1', 'weak hash', 'random', 'insecure cipher', 'ecb'],
    whatItMeans: 'Outdated or weak cryptography is used, so protected data can be guessed or decrypted.',
    businessImpact: 'Passwords or sensitive data may be recoverable by attackers; it can also fail compliance audits.',
    howToFix: 'Use modern algorithms (AES-GCM, SHA-256+, bcrypt/argon2 for passwords) and cryptographically secure random generators.',
  },
  {
    key: 'xxe', cwes: ['611', '776'], words: ['xxe', 'xml external entit'],
    whatItMeans: 'The XML parser processes external entities, letting an attacker read files or call internal systems via crafted XML.',
    businessImpact: 'Exposure of server files and internal network access.',
    howToFix: 'Disable DTDs and external entity resolution in the XML parser configuration.',
  },
  {
    key: 'redirect', cwes: ['601'], words: ['open redirect'],
    whatItMeans: 'The application redirects users to a URL taken from input, which attackers use for convincing phishing links.',
    businessImpact: 'Customers can be tricked into giving credentials to a fake site that started on your real domain.',
    howToFix: 'Only redirect to relative paths or an allow-list of known destinations.',
  },
  {
    key: 'logging', cwes: ['117', '532', '209', '200', '215'], words: ['information exposure', 'log injection', 'stack trace', 'sensitive information', 'privacy violation'],
    whatItMeans: 'Sensitive information is exposed through logs, error messages or responses.',
    businessImpact: 'Leaks personal data or internal details that make further attacks easier; may breach privacy regulations.',
    howToFix: 'Return generic error messages, mask sensitive fields in logs and responses, and review what is logged.',
  },
  {
    key: 'csrf', cwes: ['352'], words: ['csrf', 'cross site request forgery', 'cross-site request forgery'],
    whatItMeans: 'A state-changing request does not verify that the user intended to make it, so another website can trigger it.',
    businessImpact: 'Attackers can make logged-in users change settings, transfer funds or perform actions unknowingly.',
    howToFix: 'Use anti-CSRF tokens or SameSite cookies, and require re-authentication for sensitive actions.',
  },
  {
    key: 'race', whyMissed: 'Each step is safe on its own; the weakness only appears when two requests interleave, which a line-by-line rule cannot see.', cwes: ['362', '367'], words: ['race condition', 'toctou'],
    whatItMeans: 'Two operations can interleave in an unsafe way, letting an attacker exploit the timing between a check and its use.',
    businessImpact: 'Can allow double-spending, bypassing limits or corrupting data — logic flaws pattern-based tools rarely catch.',
    howToFix: 'Use atomic operations, database transactions or locks around check-then-act logic.',
  },
  {
    key: 'iac', cwes: [], words: ['bucket', 'encryption', 'public', 'security group', 'privileged', 'root', 'container', 'ingress', 'tls', 'logging disabled', 'iam'],
    whatItMeans: 'Cloud or infrastructure configuration is less secure than recommended (for example public access, missing encryption or excess privileges).',
    businessImpact: 'Misconfigurations are a leading cause of cloud breaches and can expose data or systems directly to the internet.',
    howToFix: 'Apply the expected value shown in the finding in your IaC templates and enforce it with policy checks in CI.',
  },
];

const GENERIC = {
  sca: {
    whatItMeans: 'A third-party open-source library used by the application has a publicly known vulnerability.',
    businessImpact: 'Known vulnerabilities are actively scanned for by attackers; exploits are often freely available.',
    howToFix: 'Upgrade the package to the recommended fixed version and re-run the scan; check whether the vulnerable function is used.',
  },
  default: {
    whatItMeans: 'The scan found a weakness in the code that could be abused by an attacker under the right conditions.',
    businessImpact: 'Depending on where it sits, it could expose data or let attackers misuse the application.',
    howToFix: 'Review the flagged code path with the details below and apply the recommended secure coding pattern.',
  },
};

export function lookup(finding) {
  const text = `${finding.title} ${finding.description}`.toLowerCase();
  const byCwe = finding.cwe && KB.find((k) => k.cwes.includes(String(finding.cwe)));
  if (byCwe) return byCwe;
  if (finding.engine === 'sca') return GENERIC.sca;
  const byWord = KB.find((k) => k.key !== 'iac' && k.words.some((w) => text.includes(w)));
  if (byWord) return byWord;
  if (finding.engine === 'kics') return KB.find((k) => k.key === 'iac');
  if (finding.engine === 'secrets') return KB.find((k) => k.key === 'secrets');
  return GENERIC.default;
}

const SEVERITY_WORDS = {
  CRITICAL: 'Fix immediately — this is the kind of issue attackers look for first.',
  HIGH: 'Fix in the current sprint — realistic and damaging if exploited.',
  MEDIUM: 'Plan a fix — exploitable under specific conditions.',
  LOW: 'Fix when convenient — limited impact on its own.',
  INFO: 'For awareness — improves overall security hygiene.',
};

export function templateExplanation(finding) {
  const k = lookup(finding);
  const where = finding.file ? ` in ${finding.file}${finding.line ? ` (line ${finding.line})` : ''}` : '';
  let howToFix = k.howToFix;
  if (finding.engine === 'sca' && finding.recommendedVersion) {
    howToFix = `Upgrade ${finding.packageName || 'the package'} to ${finding.recommendedVersion} or later. ${k.howToFix}`;
  } else if (finding.engine === 'kics' && finding.expected) {
    howToFix = `Expected: ${finding.expected}. ${k.howToFix}`;
  }
  return {
    plainTitle: finding.title,
    whatItMeans: finding.fusionInsight ? finding.fusionInsight : `${k.whatItMeans}${where ? ` Found${where}.` : ''}`,
    businessImpact: k.businessImpact,
    howToFix,
    urgency: SEVERITY_WORDS[finding.severity] ?? SEVERITY_WORDS.INFO,
    whyFusionFoundIt: finding.fusionOnly
      ? k.whyMissed ?? 'Fusion reasons about how the application behaves across files and frameworks, rather than matching known code patterns — which is how it surfaced an issue the rule-based engines did not report.'
      : '',
    source: 'template',
  };
}

// ---------------------------------------------------------------------------
// Fusion-only findings: why the deterministic engines did not report it, and why Fusion did.
// Written at scan time for every Fusion-only finding, by kind of weakness, with the finding's own
// evidence (files, path length, Fusion's own words) so the booth never improvises.
// ---------------------------------------------------------------------------
const MISSED = [
  {
    key: 'access', cwes: ['284', '285', '639', '862', '863', '269', '287', '306', '307', '384', '613', '640'], words: ['authoriz', 'authoris', 'access control', 'idor', 'privilege', 'authentication', 'session'],
    missed: 'Rule-based SAST looks for something dangerous that is present — a tainted value reaching a risky call. A missing or incomplete permission check is an absence: there is no dangerous call to match, and whether a check is "enough" depends on who is meant to see the data, which no rule knows.',
    caught: 'Fusion reads the route, the handler and the data it returns together and asks what the code is meant to protect. It found data or an action a caller can reach without the check that should guard it — for example an object fetched by an identifier the client supplies, with nothing confirming it belongs to that caller.',
  },
  {
    key: 'logic', cwes: ['362', '367', '841', '799', '770', '840'], words: ['race', 'business logic', 'workflow', 'toctou', 'limit', 'replay'],
    missed: 'Business-logic flaws are correct code doing the wrong thing: every line is safe on its own. Rules match code shapes, so a step that can be skipped, repeated or run twice at once leaves nothing for a rule to find.',
    caught: 'Fusion follows the whole flow — the order of the steps, what each one assumes was checked before — and found a path where that assumption does not hold.',
  },
  {
    key: 'injection', cwes: ['89', '77', '78', '94', '917', '611', '776', '943', '90', '643'], words: ['injection', 'sql', 'command', 'eval', 'template', 'xpath', 'ldap'],
    missed: 'SAST rules describe each framework\'s sources, sinks and sanitisers. Here the input travels through code the rules have no model for — a helper, a wrapper or a dynamic call across files — so the flow breaks before it reaches a known sink, or a home-grown "sanitiser" is wrongly trusted.',
    caught: 'Fusion followed the value through every hop without needing a rule for each library, and judged that what happens to it on the way does not make it safe at the point it is used.',
  },
  {
    key: 'web', cwes: ['79', '80', '352', '601', '1021', '942', '346'], words: ['xss', 'cross-site', 'redirect', 'csrf', 'cors', 'origin'],
    missed: 'Rules flag known output functions and known missing headers. Here the unsafe behaviour comes from how the front end and the API are put together — data rendered on another page, or a protection switched off in configuration — which no single file shows.',
    caught: 'Fusion connected the front-end code, the API and its configuration and saw the attacker-controlled value reach the browser (or the protection missing) on a path a visitor can actually use.',
  },
  {
    key: 'secrets', cwes: ['798', '259', '321', '540', '312', '522', '256'], words: ['secret', 'password', 'credential', 'hardcoded', 'hard-coded', 'key'],
    missed: 'Secret detection matches known key formats and high-entropy strings. A credential that looks ordinary, is assembled in code, or is only sensitive because of where it is used does not match any pattern.',
    caught: 'Fusion understood what the value is used for — signing, logging in, reaching a service — and recognised it as a credential by its role rather than its shape.',
  },
  {
    key: 'crypto', cwes: ['326', '327', '328', '330', '338', '916', '759', '760', '347'], words: ['crypto', 'cipher', 'hash', 'random', 'token', 'jwt', 'signature'],
    missed: 'Rules flag weak algorithm names. Here the algorithm names are fine; the weakness is in how they are used — a predictable seed, a token that is never verified, a key reused for another purpose.',
    caught: 'Fusion followed the token or key from where it is made to where it is trusted and saw the guarantee the code relies on is not actually provided.',
  },
  {
    key: 'data', cwes: ['200', '209', '532', '117', '215', '359', '201'], words: ['exposure', 'sensitive', 'leak', 'log', 'disclosure', 'pii'],
    missed: 'Whether data is sensitive depends on what it is, not on the code that handles it. Rules see an ordinary object returned or logged; they cannot tell that it carries personal or secret fields.',
    caught: 'Fusion read the data model behind the response and recognised fields that should never leave the service, on a path an outside caller can reach.',
  },
  {
    key: 'ssrf', cwes: ['918'], words: ['ssrf', 'server-side request', 'url'],
    missed: 'The request is built in one place and sent in another, often through an HTTP client wrapper the rules do not model, so the link between the user\'s input and the outgoing call is lost.',
    caught: 'Fusion traced the address from the incoming request to the outgoing call and to the cloud resources the service can reach from inside.',
  },
  {
    key: 'files', cwes: ['22', '23', '36', '73', '434', '502'], words: ['path', 'upload', 'file', 'deserializ', 'deserialis'],
    missed: 'The file name or the object is checked, but the check does not cover what is actually used later — a pattern that is safe in one file and unsafe once the pieces are combined.',
    caught: 'Fusion compared the check with what is really opened, stored or deserialised further down and found the gap between them.',
  },
];
const MISSED_DEFAULT = {
  missed: 'Deterministic engines report only what a written rule describes. This weakness depends on how several parts of the application behave together, so no single rule matches it.',
  caught: 'Fusion reasons about the application as a whole — code, services and cloud resources — instead of matching patterns, and found a path an attacker can use.',
};

const engineNames = { sast: 'SAST', sca: 'SCA', kics: 'IaC Security', apisec: 'API Security', containers: 'Container Security', microengines: 'Secret Detection' };

/**
 * For a Fusion-only finding: { whyMissed, whyCaught, evidence[] } in plain words.
 * `profile`: the scan profile that ran (engines, llmModel, presetName).
 */
export function fusionExplanation(finding, profile = {}) {
  const text = `${finding.title} ${finding.description} ${finding.cwe ?? ''}`.toLowerCase();
  const k = MISSED.find((m) => finding.cwe && m.cwes.includes(String(finding.cwe))) ?? MISSED.find((m) => m.words.some((w) => text.includes(w))) ?? MISSED_DEFAULT;
  const engines = (profile.engines ?? ['sast', 'sca']).map((e) => engineNames[e] ?? e.toUpperCase());
  const files = [...new Set((finding.nodes ?? []).map((n) => n.fileName).filter(Boolean))];
  const evidence = [];
  if (engines.length) evidence.push(`${engines.join(' and ')} ran on the same code${profile.presetName ? ` (preset ${profile.presetName})` : ''} and reported nothing at this location.`);
  if (files.length > 1) evidence.push(`The path crosses ${files.length} files: ${files.slice(0, 4).join(' → ')}${files.length > 4 ? ' → …' : ''}.`);
  else if (finding.file) evidence.push(`Found at ${finding.file}${finding.line ? `, line ${finding.line}` : ''}.`);
  if ((finding.nodes ?? []).length > 2) evidence.push(`${finding.nodes.length} steps from where the data enters to where it is used.`);
  if (profile.llmModel) evidence.push(`Reasoned by Fusion with the ${profile.llmModel} model.`);
  return {
    whyMissed: `${k.missed}`,
    whyCaught: finding.fusionInsight ? `${k.caught} In Fusion's words: ${finding.fusionInsight}` : k.caught,
    evidence,
  };
}
