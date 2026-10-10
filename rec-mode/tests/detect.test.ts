import { describe, expect, test } from 'claude-code/testing'

import { findSpans, maskDeep, maskText, pieces } from '../hooks/detect'
import type { Context } from '../hooks/detect'
import { lineSegments, splitBlocks } from '../hooks/md'

const ctx: Context = { users: ['tomek'], names: ['jankowalski', 'Marcin'] }
const found = (text: string, c: Context = ctx) => findSpans(text, c).map(s => text.slice(s.start, s.end))

describe('what rec-mode blurs', () => {
  test('emails', () => {
    expect(found('Napisz do jan.kowalski+yt@firma.co.uk albo ola@x.io.')).toEqual(['jan.kowalski+yt@firma.co.uk', 'ola@x.io'])
  })

  test('provider keys, JWTs, bearer tokens and KEY=value', () => {
    const key = 'sk-ant-api03-' + 'a1B2c3D4e5F6g7H8i9J0'
    expect(found(`ANTHROPIC_API_KEY=${key}`)).toEqual([key])
    expect(found('token ghp_' + 'x'.repeat(36))).toEqual(['ghp_' + 'x'.repeat(36)])
    expect(found('aws AKIAIOSFODNN7EXAMPLE')).toEqual(['AKIAIOSFODNN7EXAMPLE'])
    expect(found('Authorization: Bearer abcdef0123456789xyz')).toEqual(['abcdef0123456789xyz'])
    expect(found('"password": "hunter2!"')).toEqual(['hunter2!'])
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk'
    expect(found(`cookie=${jwt}`)).toEqual([jwt])
  })

  test('token counts and flags are not secrets', () => {
    expect(found('input_tokens: 123456, max_tokens=4096, secret: true')).toEqual([])
  })

  test('IPv4 and IPv6, not version numbers or times', () => {
    expect(found('VPS 203.0.113.20, LAN 192.168.1.10')).toEqual(['203.0.113.20', '192.168.1.10'])
    expect(found('Claude Code 2.1.293, node 22.11.0, 12:30:45')).toEqual([])
    expect(found('link-local fe80::1ff:fe23:4567:890a done')).toEqual(['fe80::1ff:fe23:4567:890a'])
  })

  test('user names: home paths, the OS user, key=value, @handles and the extra names', () => {
    expect(found('/Users/tomek/Developer and /home/ubuntu-dev/app')).toEqual(['tomek', 'ubuntu-dev'])
    expect(found('drwxr-xr-x  7 tomek  staff  224 Oct  6')).toEqual(['tomek'])
    expect(found('Tomek nagrywa odcinek')).toEqual([]) // the OS user in its own case only
    expect(found('git config user.name=jankowalski')).toEqual(['jankowalski'])
    expect(found('kanał @mojkanal i @anthropic-ai/sdk, @param x')).toEqual(['@mojkanal'])
    expect(found('wyślij Marcinowi, JanKowalski pisze')).toEqual(['Marcinowi', 'JanKowalski'])
  })

  test('the longer span wins where two overlap', () => {
    expect(found('tomek@example.com')).toEqual(['tomek@example.com'])
  })

  test('a clean text has nothing to blur', () => {
    expect(found('Plan etapu 3: posty z plikami i wideo, wydanie 0.2.0.')).toEqual([])
  })
})

describe('masking', () => {
  test('dots keep the length and the line breaks', () => {
    expect(maskText('mail: ola@x.io', ctx)).toBe('mail: ••••••••')
    const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
    expect(maskText(pem, ctx).split('\n').map(l => l.length)).toEqual([27, 3, 25])
  })

  test('maskDeep returns the same object when nothing changes', () => {
    const clean = { command: 'ls -la', list: ['a', 1] }
    expect(maskDeep(clean, ctx)).toBe(clean)
    expect(maskDeep({ command: 'cat /Users/tomek/.zshrc', n: 2 }, ctx)).toEqual({ command: 'cat /Users/•••••/.zshrc', n: 2 })
  })

  test('pieces split a line into plain text and secrets', () => {
    expect(pieces('IP 10.0.0.7 tu', ctx)).toEqual([
      { text: 'IP ', isSecret: false },
      { text: '10.0.0.7', isSecret: true },
      { text: ' tu', isSecret: false },
    ])
  })
})

describe('Markdown blocks', () => {
  test('a fence is one block, blank lines included; an open fence too', () => {
    const blocks = splitBlocks('Intro\n\n```bash\nssh root@1.2.3.4\n\nexit\n```\n\nKoniec\n\n```\nopen')
    expect(blocks.map(b => b.kind)).toEqual(['text', 'fence', 'text', 'fence'])
    const fence = blocks[1]
    expect(fence?.kind === 'fence' && fence.body).toEqual(['ssh root@1.2.3.4', '', 'exit'])
  })

  test('a line reads as styled segments', () => {
    expect(lineSegments('- **Mail:** `ola@x.io` i [link](https://x.io)')).toEqual([
      { text: '• ', style: 'plain' },
      { text: 'Mail:', style: 'bold' },
      { text: ' ', style: 'plain' },
      { text: 'ola@x.io', style: 'code' },
      { text: ' i ', style: 'plain' },
      { text: 'link', style: 'plain' },
    ])
    expect(lineSegments('## Serwer')).toEqual([{ text: 'Serwer', style: 'bold' }])
  })
})
