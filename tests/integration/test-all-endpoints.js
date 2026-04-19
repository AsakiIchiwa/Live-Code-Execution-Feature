const http = require('http');
const BASE = 'http://localhost:3000';
let T = '', AT = '', RT = '', ART = '';
let packId, lpId, lessonId, sessionId, execId, subId;
let pass = 0, fail = 0;

function req(m, p, b, t) {
  return new Promise((res, rej) => {
    const u = new URL(p, BASE);
    const o = { method: m, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: {} };
    if (t) o.headers['Authorization'] = `Bearer ${t}`;
    if (b) o.headers['Content-Type'] = 'application/json';
    const r = http.request(o, rs => {
      let d = '';
      rs.on('data', c => d += c);
      rs.on('end', () => { try { res({ s: rs.statusCode, d: JSON.parse(d) }); } catch { res({ s: rs.statusCode, d }); } });
    });
    r.on('error', rej);
    if (b) r.write(JSON.stringify(b));
    r.end();
  });
}
function ok(n, r, expect) {
  const good = expect ? r.s === expect : (r.s >= 200 && r.s < 300);
  if (good) { pass++; console.log(`✅ ${n} [${r.s}]`); }
  else { fail++; console.log(`❌ ${n} [${r.s}] ${JSON.stringify(r.d).slice(0,150)}`); }
  return r;
}

async function run() {
  console.log('=== HEALTH & SYSTEM ===');
  ok('Health', await req('GET', '/health'));
  ok('Worker health', await req('GET', '/health/worker'));
  ok('System status', await req('GET', '/api/v1/system/status'));
  ok('Supported langs', await req('GET', '/api/v1/system/supported-languages'));
  ok('Runtime config', await req('GET', '/api/v1/system/runtime-config'));

  console.log('\n=== AUTH ===');
  // Register fresh user
  const email = `test${Date.now()}@test.com`;
  let r = ok('Register', await req('POST', '/api/v1/auth/register', { email, password: 'pass1234', display_name: 'Tester' }), 201);
  T = r.d.access_token; RT = r.d.refresh_token;

  r = ok('Login', await req('POST', '/api/v1/auth/login', { email, password: 'pass1234' }));
  T = r.d.access_token; RT = r.d.refresh_token;

  r = ok('Device login', await req('POST', '/api/v1/auth/device-login', { device_id: `dev-${Date.now()}` }));

  r = ok('Refresh token', await req('POST', '/api/v1/auth/refresh', { refresh_token: RT }));
  T = r.d.access_token;

  ok('Get me', await req('GET', '/api/v1/auth/me', null, T));

  // Unauth test
  ok('No auth → 401', await req('GET', '/api/v1/auth/me'), 401);

  console.log('\n=== USER PROFILE & SETTINGS ===');
  ok('Update profile', await req('PATCH', '/api/v1/users/me', { display_name: 'Updated' }, T));
  ok('Get settings', await req('GET', '/api/v1/users/me/settings', null, T));
  ok('Update settings', await req('PATCH', '/api/v1/users/me/settings', { font_size: 18, editor_theme: 'dark' }, T));

  console.log('\n=== LANGUAGE PACKS ===');
  r = ok('List lang packs', await req('GET', '/api/v1/language-packs', null, T));
  packId = (r.d.packs || r.d)[0].id;

  ok('Get lang pack', await req('GET', `/api/v1/language-packs/${packId}`, null, T));
  ok('Unlock lang pack', await req('POST', `/api/v1/language-packs/${packId}/unlock`, {}, T));
  ok('Install lang pack', await req('POST', `/api/v1/language-packs/${packId}/install`, {}, T));
  ok('User lang packs', await req('GET', '/api/v1/users/me/language-packs', null, T));
  ok('Lang manifest', await req('GET', `/api/v1/language-packs/${packId}/manifest`, null, T));
  ok('Uninstall lang pack', await req('DELETE', `/api/v1/users/me/language-packs/${packId}`, null, T));

  console.log('\n=== LESSON PACKS ===');
  r = ok('List lesson packs', await req('GET', '/api/v1/lesson-packs', null, T));
  // Find a pack that has lessons (the seeded Java Basics pack)
  const allPacks = r.d.items || r.d.packs || r.d;
  lpId = allPacks.find(p => p.totalLessons > 0 || p.total_lessons > 0)?.id || allPacks[0].id;

  ok('Get lesson pack', await req('GET', `/api/v1/lesson-packs/${lpId}`, null, T));
  ok('Unlock lesson pack', await req('POST', `/api/v1/lesson-packs/${lpId}/unlock`, {}, T));
  ok('User lesson packs', await req('GET', '/api/v1/users/me/lesson-packs', null, T));
  ok('Lesson manifest', await req('GET', `/api/v1/lesson-packs/${lpId}/manifest`, null, T));

  r = ok('Lessons list', await req('GET', `/api/v1/lesson-packs/${lpId}/lessons`, null, T));
  const lessons = r.d.lessons || r.d || [];
  lessonId = lessons.length > 0 ? lessons[0].id : null;

  if (lessonId) {
    ok('Lesson detail', await req('GET', `/api/v1/lessons/${lessonId}`, null, T));

    console.log('\n=== TESTS & CONTENT ===');
    ok('Test summary', await req('GET', `/api/v1/lessons/${lessonId}/test-summary`, null, T));
    ok('Public tests', await req('GET', `/api/v1/lessons/${lessonId}/public-tests`, null, T));
  } else {
    console.log('⚠️  No lessons found, skipping lesson/test/submission/progress tests');
  }

  console.log('\n=== CODE SESSIONS ===');
  r = ok('Create session', await req('POST', '/api/v1/code-sessions', { language: 'java', title: 'Test' }, T), 201);
  sessionId = r.d.session_id;

  ok('List sessions', await req('GET', '/api/v1/code-sessions', null, T));
  ok('Get session', await req('GET', `/api/v1/code-sessions/${sessionId}`, null, T));
  ok('Autosave (PATCH)', await req('PATCH', `/api/v1/code-sessions/${sessionId}`, { source_code: 'hello', version: 1 }, T));
  ok('Autosave (POST)', await req('POST', `/api/v1/code-sessions/${sessionId}/autosave`, { source_code: 'hello2', version: 2 }, T));
  ok('Delete session', await req('DELETE', `/api/v1/code-sessions/${sessionId}`, null, T));

  if (lessonId) {
    console.log('\n=== SUBMISSIONS ===');
    r = ok('Submit code', await req('POST', `/api/v1/lessons/${lessonId}/submissions`, { source_code: 'public class Main { public static void main(String[] args) { System.out.println("Hello"); } }', language: 'java' }, T));
    subId = r.d.id || (r.d.submission && r.d.submission.id);

    if (subId) {
      ok('Get submission', await req('GET', `/api/v1/submissions/${subId}`, null, T));
      ok('Submission result', await req('GET', `/api/v1/submissions/${subId}/result`, null, T));
      ok('List lesson subs', await req('GET', `/api/v1/lessons/${lessonId}/submissions`, null, T));
      ok('Recheck', await req('POST', `/api/v1/submissions/${subId}/recheck`, {}, T));
    }

    console.log('\n=== PROGRESS ===');
    ok('Progress overview', await req('GET', '/api/v1/users/me/progress', null, T));
    ok('Pack progress', await req('GET', `/api/v1/users/me/progress/lesson-packs/${lpId}`, null, T));
    ok('Lesson progress', await req('GET', `/api/v1/users/me/progress/lessons/${lessonId}`, null, T));
    ok('Update progress', await req('PATCH', `/api/v1/users/me/progress/lessons/${lessonId}`, { status: 'IN_PROGRESS', time_spent: 60 }, T));
    ok('Complete lesson', await req('POST', `/api/v1/lessons/${lessonId}/complete`, {}, T));
    ok('Unlock next', await req('POST', `/api/v1/lessons/${lessonId}/unlock-next`, {}, T));
  }

  console.log('\n=== DOWNLOADS ===');
  ok('Download lang pack', await req('GET', `/api/v1/downloads/language-packs/${packId}`, null, T));
  ok('Download lesson pack', await req('GET', `/api/v1/downloads/lesson-packs/${lpId}`, null, T));

  console.log('\n=== ADMIN ===');
  r = ok('Admin login', await req('POST', '/api/v1/auth/login', { email: 'admin@edtronaut.ai', password: 'admin123' }));
  AT = r.d.access_token;

  const uniqueCode = 'lang' + Date.now();
  r = ok('Create lang pack', await req('POST', '/api/v1/admin/language-packs', { code: uniqueCode, name: 'Test Lang', description: 'Test', version: '1.0.0', is_free: true }, AT), 201);
  const newLpId = r.d.id;
  ok('Update lang pack', await req('PATCH', `/api/v1/admin/language-packs/${newLpId}`, { description: 'Updated' }, AT));
  ok('Publish lang pack', await req('POST', `/api/v1/admin/language-packs/${newLpId}/publish`, {}, AT));

  r = ok('Create lesson pack', await req('POST', '/api/v1/admin/lesson-packs', { language_pack_id: packId, title: 'Test Pack', description: 'test', difficulty: 'BEGINNER' }, AT), 201);
  const newLessonPackId = r.d.id;
  ok('Update lesson pack', await req('PATCH', `/api/v1/admin/lesson-packs/${newLessonPackId}`, { description: 'Updated' }, AT));

  r = ok('Create lesson', await req('POST', '/api/v1/admin/lessons', { lesson_pack_id: newLessonPackId, title: 'L1', description: 'desc', instructions: 'do it', order_index: 1, type: 'CODING', difficulty: 'BEGINNER' }, AT), 201);
  const newLessonId = r.d.id;
  ok('Update lesson', await req('PATCH', `/api/v1/admin/lessons/${newLessonId}`, { description: 'Updated' }, AT));

  r = ok('Create test case', await req('POST', `/api/v1/admin/lessons/${newLessonId}/test-cases`, { input: '5', expected: '25', is_public: true, order_index: 1 }, AT), 201);
  const tcId = r.d.id;
  if (tcId) ok('Update test case', await req('PATCH', `/api/v1/admin/test-cases/${tcId}`, { description: 'Updated' }, AT));

  ok('Publish lesson pack', await req('POST', `/api/v1/admin/lesson-packs/${newLessonPackId}/publish`, {}, AT));

  // Unpublish
  ok('Unpublish lang pack', await req('POST', `/api/v1/admin/language-packs/${newLpId}/unpublish`, {}, AT));
  ok('Unpublish lesson pack', await req('POST', `/api/v1/admin/lesson-packs/${newLessonPackId}/unpublish`, {}, AT));

  // Delete test case
  if (tcId) ok('Delete test case', await req('DELETE', `/api/v1/admin/test-cases/${tcId}`, null, AT));

  // Soft delete
  ok('Delete lesson', await req('DELETE', `/api/v1/admin/lessons/${newLessonId}`, null, AT));
  ok('Delete lesson pack', await req('DELETE', `/api/v1/admin/lesson-packs/${newLessonPackId}`, null, AT));
  ok('Delete lang pack', await req('DELETE', `/api/v1/admin/language-packs/${newLpId}`, null, AT));

  // Role management: promote test user to CREATOR
  const meRes = await req('GET', '/api/v1/auth/me', null, T);
  const testUserId = meRes.d.id || meRes.d.user?.id;
  ok('Promote to creator', await req('POST', `/api/v1/admin/users/${testUserId}/promote-creator`, {}, AT));

  console.log('\n=== MARKETPLACE (Creator) ===');
  // Now test user is CREATOR, re-login to get new token with CREATOR role
  r = ok('Creator login', await req('POST', '/api/v1/auth/login', { email, password: 'pass1234' }));
  const CT = r.d.access_token;

  const mktCode = 'mkt' + Date.now();
  r = ok('Creator: create lang pack', await req('POST', '/api/v1/marketplace/language-packs', { code: mktCode, name: 'My Lang', description: 'Creator pack', is_free: true }, CT), 201);

  r = ok('Creator: my submissions', await req('GET', '/api/v1/marketplace/my-submissions', null, CT));
  const mktSubId = r.d[0]?.id;

  if (mktSubId) {
    ok('Creator: update submission', await req('PATCH', `/api/v1/marketplace/submissions/${mktSubId}`, { description: 'Updated desc' }, CT));
    ok('Creator: submit for review', await req('POST', `/api/v1/marketplace/submissions/${mktSubId}/submit`, {}, CT));

    console.log('\n=== MARKETPLACE (Admin Review) ===');
    r = ok('Admin: pending reviews', await req('GET', '/api/v1/admin/marketplace/pending', null, AT));
    ok('Admin: approve', await req('POST', `/api/v1/admin/marketplace/${mktSubId}/approve`, {}, AT));
  }

  console.log('\n=== MARKETPLACE (Public) ===');
  ok('Browse marketplace', await req('GET', '/api/v1/marketplace'));
  if (mktSubId) ok('Get marketplace item', await req('GET', `/api/v1/marketplace/${mktSubId}`));

  // Demote back
  ok('Demote to user', await req('POST', `/api/v1/admin/users/${testUserId}/demote`, {}, AT));

  // Non-admin should fail
  ok('Admin guard', await req('POST', '/api/v1/admin/language-packs', { code: 'x', name: 'x' }, T), 403);
  // Non-creator should fail
  ok('Creator guard', await req('POST', '/api/v1/marketplace/language-packs', { code: 'x', name: 'x' }, T), 403);

  console.log('\n=== LOGOUT ===');
  ok('Logout', await req('POST', '/api/v1/auth/logout', {}, T));

  console.log(`\n${'='.repeat(40)}`);
  console.log(`✅ Passed: ${pass}`);
  console.log(`❌ Failed: ${fail}`);
  console.log(`Total: ${pass + fail}`);
}
run().catch(e => { console.error(e); process.exit(1); });
