---
title: Pulse Agent Monitoring Upgrade Plan
status: draft
created: 2026-03-23
author: livevil7
version: v0.2.0 → v1.0.0
target: 범용 배포 (VS Code Marketplace)
---

# Pulse Agent Monitoring Upgrade Plan

## 0. 핵심 원칙: 범용 독립 플러그인

Pulse는 **모든 Claude Code 사용자**가 설치하여 사용할 수 있는 범용 VS Code 확장입니다.

### 0.1 독립성 요구사항

| 원칙 | 설명 |
|------|------|
| lens 의존성 제거 | lens 플러그인 없이도 Pulse가 단독 동작해야 함 |
| 자체 데이터 수집 | Pulse가 Claude Code hooks를 자체 내장하여 데이터 생산 |
| 설치 즉시 동작 | `code --install-extension pulse.vsix` 하나로 완료 |
| 크로스 플랫폼 | Windows, macOS, Linux 모두 지원 |
| 외부 의존성 최소화 | node_modules 없이 VS Code API만으로 동작 |

### 0.2 아키텍처 전환

```
[현재 — lens 의존]
  lens hooks → .lens/agent-dashboard.json → Pulse 읽기
  문제: lens 미설치 시 동작 안 함

[목표 — 자체 수집]
  방법 A: Pulse 자체 Claude Code 플러그인 내장
    Pulse VS Code Extension
    ├── Claude Code hooks (내장)     ← 데이터 생산
    └── VS Code WebView/TreeView    ← 데이터 소비

  방법 B: Claude Code transcript 직접 감시
    ~/.claude/projects/{hash}/{session}/*.jsonl
    Pulse가 직접 파싱하여 에이전트 상태 추론

  방법 C: 오픈 스키마 (어떤 생산자든 호환)
    Pulse는 .pulse/agent-dashboard.json을 읽기만 함
    lens, 또는 사용자 자체 hooks, 또는 Pulse 내장 hook이 쓰기
```

### 0.3 권장 전략: 방법 A + C 혼합

1. **Pulse 자체 Claude Code 플러그인을 번들** — 설치 시 자동으로 hooks 등록
2. **오픈 스키마 유지** — 다른 도구가 같은 JSON을 쓸 수도 있음
3. **lens 호환** — lens가 있으면 lens 데이터도 읽을 수 있음 (폴백)
4. **데이터 폴더**: `.pulse/` (Pulse 자체) 우선, `.lens/` 폴백

### 0.4 배포 채널

| 채널 | 대상 | 방식 |
|------|------|------|
| VS Code Marketplace | 모든 개발자 | `ext install CreetaCorp.pulse` |
| GitHub Releases | 수동 설치 | `.vsix` 다운로드 |
| Open VSX | VS Code 대안 사용자 | Open VSX Registry |

---

## 1. 현재 상태 분석

### 1.1 아키텍처

```
[lens plugin]                    [Pulse VS Code Extension]
  hooks/                           src/
  ├── session-start.js               ├── extension.ts        ← 진입점, 멀티프로젝트 관리
  ├── pre-tool-task.js               ├── AgentWatcher.ts     ← .lens/ 파일 감시
  ├── post-tool-task.js              ├── AgentTreeProvider.ts ← 사이드바 트리뷰
  ├── stop.js                        ├── DashboardPanel.ts   ← WebView 대시보드 UI
  lib/                               ├── TranscriptReader.ts ← .jsonl 사고과정 읽기
  └── agent-tracker.js               ├── StatusBarManager.ts ← 하단 상태바
                                     └── types.ts            ← 공유 타입 정의
       ↓ 쓰기                             ↓ 읽기
  .lens/agent-dashboard.json ──────────────┘
```

> **문제**: 이 구조는 lens 플러그인이 설치되어야만 동작함. 범용 배포 불가.

### 1.2 현재 기능

| 기능 | 구현 상태 | 비고 |
|------|-----------|------|
| 서브 에이전트 추적 | ✅ 동작 | Task matcher로 PreToolUse/PostToolUse |
| WebView 대시보드 | ✅ 동작 | 사이버펑크 UI, 에이전트 카드 그리드 |
| 사이드바 트리뷰 | ✅ 동작 | 상태별 아이콘, 세션 정보 |
| 상태바 | ✅ 동작 | 실행 중 카운트, 클릭 시 대시보드 열기 |
| Transcript 읽기 | ✅ 동작 | .jsonl에서 thinking/tool_use 파싱 |
| 멀티 프로젝트 | ✅ 동작 | 워크스페이스 폴더별 독립 watcher |
| 자동 열기 | ✅ 동작 | running 0→N 전환 시만 |
| Stale 세션 감지 | ✅ 동작 | 3분 무응답 시 error 처리 |
| 프로그레스 바 | ✅ 동작 | 에이전트 완료율 시각화 |
| LIVE 뱃지 | ✅ 동작 | 실행 중 빨간 점 깜빡임 |

### 1.3 한계

| 한계 | 영향 |
|------|------|
| 메인 에이전트 미추적 | 서브 에이전트 없으면 대시보드 빈 화면 |
| 도구 사용 내역 없음 | "뭘 하고 있는지" 알 수 없음 |
| 에이전트 계층 없음 | 병렬 에이전트들의 관계 파악 불가 |
| Transcript 매칭 불안정 | prompt prefix 80자 매칭, 실패 가능 |
| 세션 히스토리 없음 | 세션 종료 시 데이터 덮어쓰기 |
| 테마 3개 선언, 1개 구현 | 설정만 있고 실제 동작 안 함 |
| 경과 시간 미표시 | 세션/에이전트가 얼마나 걸리는지 모름 |

---

## 2. 설계: 3-Layer 모니터링 모델

### 2.1 개념

```
Layer 1: Session (세션 수준)
  └── "Claude가 일하고 있나? 얼마나 걸리고 있나?"

Layer 2: Agent (에이전트 수준) ← 핵심 레이어
  └── "어떤 에이전트들이 돌고 있나? 각각 뭘 맡았나?"

Layer 3: Activity (활동 수준) ← opt-in
  └── "지금 어떤 파일을 읽고 있나? 무슨 명령을 실행했나?"
```

기본값은 Layer 1 + Layer 2. Layer 3은 설정으로 활성화.

### 2.2 데이터 스키마 v2

```jsonc
{
  "$schema": "pulse-agent-dashboard/2.0.0",
  "session": {
    "id": "sess_xxx",
    "startedAt": "ISO",
    "endedAt": null,
    "status": "active"        // active | completed | error
  },
  "agents": [
    {
      "id": "main",
      "name": "Main Agent",
      "parentId": null,             // 신규: 계층 구조
      "status": "running",
      "startedAt": "ISO",
      "endedAt": null,
      "durationMs": null,
      "error": null,
      "description": "",
      "toolCounts": {               // 신규: 도구 사용 요약
        "Read": 5,
        "Edit": 2,
        "Bash": 1,
        "Agent": 3
      },
      "lastActivity": {            // 신규: 마지막 활동
        "tool": "Edit",
        "target": "src/extension.ts",
        "at": "ISO"
      }
    },
    {
      "id": "agent_xxx",
      "name": "Search codebase",
      "parentId": "main",          // main의 자식
      "status": "done",
      "startedAt": "ISO",
      "endedAt": "ISO",
      "durationMs": 3200,
      "error": null,
      "description": "Find all TypeScript files",
      "toolCounts": { "Read": 3, "Grep": 2 },
      "lastActivity": null
    }
  ],
  "summary": {
    "total": 4,
    "pending": 0,
    "running": 1,
    "done": 3,
    "error": 0
  },
  "recentActivity": [             // 신규: Layer 3 (opt-in)
    {
      "agentId": "main",
      "tool": "Read",
      "target": "package.json",
      "at": "ISO"
    }
  ],
  "errors": [],
  "lastUpdatedAt": "ISO"
}
```

### 2.3 하위호환성

- v1 스키마 (`lens-agent-dashboard/1.0.0`)도 읽을 수 있어야 함 (lens 사용자 호환)
- Pulse에서 `parentId`, `toolCounts`, `lastActivity`, `recentActivity`가 없으면 무시
- 데이터 폴더 탐색 순서: `.pulse/` → `.lens/` (폴백)
- Pulse 자체 hooks는 항상 `.pulse/`에 기록

---

## 3. 변경 범위

### 3.1 Pulse 내장 Claude Code 플러그인 (신규 — 데이터 생산자)

Pulse가 자체적으로 Claude Code hooks를 번들하여, lens 없이 독립 동작.

```
pulse/
├── src/                          ← VS Code Extension (기존)
├── claude-plugin/                ← 신규: Claude Code 플러그인
│   ├── .claude-plugin/
│   │   └── plugin.json           ← 플러그인 매니페스트
│   ├── hooks/
│   │   ├── hooks.json
│   │   ├── session-start.js      ← 세션 시작 + 메인 에이전트 등록
│   │   ├── pre-tool-task.js      ← Task 시작 추적
│   │   ├── post-tool-task.js     ← Task 완료 추적
│   │   ├── pre-tool-all.js       ← 전체 도구 추적 (opt-in)
│   │   ├── post-tool-all.js      ← 전체 도구 완료 (opt-in)
│   │   └── stop.js               ← 세션 종료
│   └── lib/
│       └── agent-tracker.js      ← 대시보드 상태 관리
```

| 구성 요소 | 상세 |
|-----------|------|
| 매니페스트 | `name: "pulse-agent-tracker"`, 최소 권한 |
| SessionStart | 세션 초기화 + `registerAgent('Main Agent', { id: 'main' })` |
| PreToolUse (Task) | 서브 에이전트 등록 (`parentId: 'main'`) |
| PostToolUse (Task) | 서브 에이전트 완료/에러 |
| PreToolUse (*) | 도구 사용 카운트 + 마지막 활동 (opt-in) |
| PostToolUse (*) | 도구 결과 기록 (opt-in) |
| Stop | 세션 종료, 고아 에이전트 에러 처리 |
| agent-tracker | `.pulse/agent-dashboard.json` 읽기/쓰기 |

#### 설치 방식

VS Code Extension 활성화 시 자동으로 Claude Code 플러그인 등록:

```typescript
// extension.ts activate()에서
const pluginDir = path.join(context.extensionPath, 'claude-plugin');
// Claude Code settings에 플러그인 경로 추가
// 또는 사용자에게 설치 안내
```

> **대안**: VS Code Extension이 직접 hooks를 등록할 수 없다면,
> 사용자가 `claude plugin install pulse-agent-tracker` 로 별도 설치.
> 이 경우 Pulse Extension은 "Install Claude Code Plugin" 버튼 제공.

### 3.2 Pulse VS Code Extension (데이터 소비자)

| 변경 | 파일 | 상세 |
|------|------|------|
| 데이터 폴더 다중 탐색 | `extension.ts` | `.pulse/` 우선 → `.lens/` 폴백 |
| 타입 확장 | `types.ts` | `parentId`, `toolCounts`, `lastActivity`, `recentActivity` 추가 |
| 트리뷰 계층화 | `AgentTreeProvider.ts` | 평면 리스트 → 부모-자식 트리 |
| 대시보드 계층 카드 | `DashboardPanel.ts` | 메인 에이전트 카드 아래 서브 에이전트 들여쓰기 |
| 경과 시간 표시 | `DashboardPanel.ts` | 실시간 타이머 (세션 + 에이전트별) |
| 도구 카운트 뱃지 | `DashboardPanel.ts` | 에이전트 카드에 `Read:5 Edit:2` 미니 뱃지 |
| 마지막 활동 표시 | `DashboardPanel.ts` | 에이전트 카드 하단에 "Last: Edit src/foo.ts" |
| 활동 스트림 패널 | `DashboardPanel.ts` | 접이식 활동 로그 (Layer 3 활성 시) |
| 테마 정리 | `package.json` | 미구현 테마 옵션 제거 또는 구현 |
| v1/v2 + lens 호환 | `AgentWatcher.ts` | 스키마 버전 감지 + 폴더 폴백 |
| 플러그인 설치 안내 | `extension.ts` | Claude Code 플러그인 미감지 시 설치 버튼 |

### 3.3 lens 플러그인 (별도 — 기존 사용자 호환)

lens 자체는 변경하지 않음. lens가 `.lens/`에 쓴 데이터를 Pulse가 폴백으로 읽을 수 있으면 충분.

### 3.4 미변경

| 항목 | 이유 |
|------|------|
| `StatusBarManager.ts` | 현재 로직 충분 (합산 표시) |
| `TranscriptReader.ts` | Phase 3에서 개선 예정 |
| 멀티 프로젝트 구조 | 현재 구조 유지 |
| 자동 열기 로직 | 현재 구조 유지 |
| Stale 세션 감지 | 현재 구조 유지 |

---

## 4. 구현 Phase

### Phase 0 — 독립화 (범용 배포 기반)

**목표**: lens 의존성 제거, Pulse 단독으로 동작하는 구조 확립

| # | 작업 | 복잡도 |
|---|------|--------|
| 0-1 | `claude-plugin/` 디렉토리 생성 — Pulse 자체 Claude Code 플러그인 | 중간 |
| 0-2 | `agent-tracker.js` 작성 — `.pulse/agent-dashboard.json` 관리 | 중간 |
| 0-3 | hooks 4개 작성 (session-start, pre-tool-task, post-tool-task, stop) | 중간 |
| 0-4 | `extension.ts` 데이터 폴더 탐색 변경 — `.pulse/` 우선, `.lens/` 폴백 | 낮음 |
| 0-5 | 플러그인 미감지 시 설치 안내 UI (정보 메시지 + 버튼) | 낮음 |
| 0-6 | 크로스 플랫폼 경로 처리 검증 (Windows 백슬래시, macOS/Linux) | 낮음 |
| 0-7 | `package.json` publisher/repository 정비, README 작성 | 낮음 |

**완료 기준**: lens 미설치 환경에서 `claude plugin install` + VS Code 확장 설치만으로 대시보드 동작

### Phase 1 — 메인 에이전트 + UI 정비

**목표**: 에이전트 0개일 때도 대시보드가 의미있게 동작

| # | 작업 | 복잡도 |
|---|------|--------|
| 1-1 | `session-start.js`에서 메인 에이전트 등록 (`id: 'main'`) | 낮음 |
| 1-2 | `agent-tracker.js`에 `parentId` 필드 추가 | 낮음 |
| 1-3 | `stop.js`에서 메인 에이전트 완료 처리 | 낮음 |
| 1-4 | Pulse `types.ts` 타입 확장 (하위호환) | 낮음 |
| 1-5 | 대시보드에 세션 경과 시간 실시간 표시 | 중간 |
| 1-6 | 미구현 테마 옵션 제거 (cyberpunk 단일) | 낮음 |
| 1-7 | 버전 범프 및 .vsix 패키징 | 낮음 |

**완료 기준**: Claude Code 단독 작업 시에도 "Main Agent: running" 표시

### Phase 2 — 에이전트 계층 + 도구 요약

**목표**: 에이전트 간 관계와 활동 요약을 한눈에 파악

| # | 작업 | 복잡도 |
|---|------|--------|
| 2-1 | `pre-tool-task.js`에서 `parentId: 'main'` 전달 | 낮음 |
| 2-2 | 전체 도구 hook 추가 (matcher `*`, 기본 비활성) | 중간 |
| 2-3 | `agent-tracker.js`에 `toolCounts`, `lastActivity` 로직 | 중간 |
| 2-4 | `pulse.trackAllTools` 설정 추가 (VS Code settings) | 낮음 |
| 2-5 | `AgentTreeProvider` 부모-자식 트리 구조 | 중간 |
| 2-6 | 대시보드 카드에 도구 사용 뱃지 | 중간 |
| 2-7 | 대시보드 카드에 마지막 활동 표시 | 낮음 |
| 2-8 | 에이전트별 경과 시간 표시 | 낮음 |
| 2-9 | 스키마 v2 전환 + v1/lens 하위호환 처리 | 중간 |

**완료 기준**: `Main Agent` 아래 서브 에이전트 트리 표시, 각 카드에 `Read:5 Edit:2` 뱃지

### Phase 3 — 활동 스트림 + 히스토리

**목표**: 도구 수준의 상세 모니터링과 세션 간 비교

| # | 작업 | 복잡도 |
|---|------|--------|
| 3-1 | 활동 로그 (`recentActivity`) 구현 | 중간 |
| 3-2 | 접이식 활동 스트림 UI | 높음 |
| 3-3 | 세션 히스토리 보관 (최근 N개 세션 요약) | 중간 |
| 3-4 | 세션 히스토리 뷰 | 높음 |
| 3-5 | TranscriptReader 안정화 (매칭 개선) | 중간 |
| 3-6 | 타임라인 뷰 (간트 차트 스타일) | 높음 |

**완료 기준**: 에이전트 카드 클릭 시 도구 사용 로그 펼침, 이전 세션 요약 조회 가능

### Phase 4 — Marketplace 배포

**목표**: 누구나 설치 가능한 상태로 공개

| # | 작업 | 복잡도 |
|---|------|--------|
| 4-1 | VS Code Marketplace publisher 등록 (CreetaCorp) | 낮음 |
| 4-2 | README.md (영문) — 스크린샷, GIF, 설치 가이드 | 중간 |
| 4-3 | CHANGELOG.md 정리 | 낮음 |
| 4-4 | 아이콘/배너 디자인 | 중간 |
| 4-5 | `vsce publish` 또는 GitHub Actions CI/CD | 중간 |
| 4-6 | Open VSX Registry 등록 | 낮음 |
| 4-7 | Claude Code 플러그인 마켓플레이스 등록 | 낮음 |

**완료 기준**: `ext install CreetaCorp.pulse` 로 설치 가능

---

## 5. Pulse 내장 hooks 상세

### Phase 0 hooks.json (초기)

```json
{
  "hooks": {
    "SessionStart": [{
      "once": true,
      "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js", "timeout": 5000 }]
    }],
    "PreToolUse": [{
      "matcher": "Task",
      "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-task.js", "timeout": 3000 }]
    }],
    "PostToolUse": [{
      "matcher": "Task",
      "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-task.js", "timeout": 3000 }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/stop.js", "timeout": 5000 }]
    }]
  }
}
```

### Phase 2 추가 hooks (opt-in 전체 도구 추적)

```json
{
  "PreToolUse": [
    { "matcher": "Task", "command": "node .../pre-tool-task.js" },
    { "matcher": "*",    "command": "node .../pre-tool-all.js"  }
  ],
  "PostToolUse": [
    { "matcher": "Task", "command": "node .../post-tool-task.js" },
    { "matcher": "*",    "command": "node .../post-tool-all.js"  }
  ]
}
```

`pre-tool-all.js` / `post-tool-all.js`는 `pulse.trackAllTools` 설정이 `true`일 때만 기록.
`false`면 즉시 exit하여 성능 영향 최소화.

### lens와의 충돌 방지

lens가 설치된 환경에서 Pulse 플러그인도 설치되면 hooks가 이중 실행될 수 있음.

| 전략 | 상세 |
|------|------|
| 데이터 폴더 분리 | lens → `.lens/`, Pulse → `.pulse/` (충돌 없음) |
| Pulse 우선 읽기 | `.pulse/` 있으면 `.lens/` 무시 |
| 중복 감지 | `session-start.js`에서 `.lens/` 존재 확인 → 이미 추적 중이면 skip 가능 |

권장: **데이터 폴더 분리** (가장 단순). 사용자가 원하면 lens 제거 안내.

---

## 6. 성능 고려사항

| 우려 | 대응 |
|------|------|
| matcher `*`로 모든 도구 hook 실행 | `trackAllTools: false` 기본값, 활성 시에도 설정 체크 후 즉시 exit |
| agent-dashboard.json 잦은 쓰기 | atomic write (tmp + rename), 크로스 플랫폼 안전 |
| recentActivity 배열 무한 증가 | `maxRecentActivity` 설정으로 제한 (기본 50) |
| Pulse 폴링 부하 | 500ms, content 비교로 변경 없으면 skip (이미 구현) |
| 세션 히스토리 파일 크기 | 요약만 보관 (에이전트 수, 소요시간, 에러 수) |
| Windows 파일 잠금 | atomic write의 rename이 실패할 수 있음 → fallback direct write |
| 대규모 워크스페이스 | 폴더당 1개 watcher, 비활성 폴더는 폴링 중단 |

---

## 7. 버전 계획

| 버전 | Phase | 스키마 | 비고 |
|------|-------|--------|------|
| pulse v0.2.0 | - | v1 (lens 의존) | 현재 |
| pulse v0.5.0 | Phase 0 | v1 (독립) | 자체 hooks, `.pulse/`, lens 폴백 |
| pulse v0.6.0 | Phase 1 | v1 (필드 추가) | 메인 에이전트, 경과 시간 |
| pulse v0.8.0 | Phase 2 | v2 | 에이전트 계층, 도구 뱃지 |
| pulse v1.0.0 | Phase 3+4 | v2 | Marketplace 배포, 활동 스트림, 히스토리 |

> lens 플러그인 버전은 변경하지 않음. Pulse가 독립하면서 lens 의존성 소멸.

---

## 8. 크로스 플랫폼 체크리스트

| 항목 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 경로 구분자 | `path.join()` 사용, 하드코딩 금지 | 동일 | 동일 |
| `~/.claude/` 위치 | `C:\Users\{user}\.claude\` | `/Users/{user}/.claude/` | `/home/{user}/.claude/` |
| atomic write | `rename`이 cross-device면 실패 → fallback | 정상 | 정상 |
| `fs.watch` 안정성 | 불안정 (폴링 필수) | 정상 | inotify 기반, 정상 |
| Claude Code 플러그인 경로 | `%APPDATA%\.claude\plugins\` | `~/.claude/plugins/` | `~/.claude/plugins/` |
| stdin 읽기 (hooks) | `fs.readFileSync(0)` 정상 | 정상 | 정상 |

---

## 9. 최종 목표 아키텍처

```
[사용자 설치]
  1. VS Code: ext install CreetaCorp.pulse
  2. Claude Code: claude plugin install pulse-agent-tracker
     (또는 VS Code에서 원클릭 설치 버튼)

[런타임]
  Claude Code Session
    │
    ├── SessionStart hook → .pulse/agent-dashboard.json 초기화
    ├── PreToolUse (Task) → 서브 에이전트 등록
    ├── PostToolUse (Task) → 서브 에이전트 완료
    ├── PreToolUse (*) → 도구 사용 카운트 (opt-in)
    └── Stop hook → 세션 종료
         │
         ▼
  .pulse/agent-dashboard.json
         │
         ▼
  Pulse VS Code Extension
    ├── AgentWatcher (파일 감시 + 폴링)
    ├── DashboardPanel (WebView 대시보드)
    ├── AgentTreeProvider (사이드바 트리)
    ├── StatusBarManager (하단 상태바)
    └── TranscriptReader (.jsonl 사고과정)

[lens 사용자 호환]
  .lens/agent-dashboard.json → Pulse가 폴백으로 읽기 가능
```
