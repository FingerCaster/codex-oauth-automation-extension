const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('hotmail helper script fetches recipients and keeps code selection inside the current time window', () => {
  const source = fs.readFileSync('scripts/hotmail_helper.py', 'utf8');

  assert.match(
    source,
    /def encode_query\(params\):/,
    '本地 helper 应统一编码 Graph\/Outlook 查询参数，避免 orderby 空格导致 URL 非法'
  );
  assert.match(
    source,
    /\$select["']:\s*"id,internetMessageId,subject,from,toRecipients,bodyPreview,receivedDateTime"/,
    'Graph 拉取应包含 toRecipients，便于按目标邮箱过滤'
  );
  assert.match(
    source,
    /\$select["']:\s*"Id,Subject,From,ToRecipients,BodyPreview,ReceivedDateTime"/,
    'Outlook API 拉取也应包含 ToRecipients'
  );
  assert.doesNotMatch(
    source,
    /\$orderby=receivedDateTime desc|\$orderby=ReceivedDateTime desc/,
    'Graph\/Outlook 查询不应再把包含空格的 orderby 直接裸拼进 URL'
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
