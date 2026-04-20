const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('hotmail helper script fetches recipients and keeps code selection inside the current time window', () => {
  const source = fs.readFileSync('scripts/hotmail_helper.py', 'utf8');

  assert.match(
    source,
    /\$select=id,internetMessageId,subject,from,toRecipients,bodyPreview,receivedDateTime/,
    'Graph 拉取应包含 toRecipients，便于按目标邮箱过滤'
  );
  assert.match(
    source,
    /\$select=Id,Subject,From,ToRecipients,BodyPreview,ReceivedDateTime/,
    'Outlook API 拉取也应包含 ToRecipients'
  );
  assert.match(
    source,
    /payload\.get\("targetEmail"\)\s+or\s+""/,
    '本地 helper 应接收目标邮箱并参与筛选'
  );
  assert.doesNotMatch(
    source,
    /for use_time_fallback in \[False, True\]/,
    '本地 helper 不应再忽略 filterAfterTimestamp 回退到旧验证码'
  );
});
