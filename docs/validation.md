# Agent Bridge 자체 검증 기록

외부 사용자 성과가 아니라, 공개 저장소에서 다시 설치해 핵심 흐름을 재현한 기록입니다.

## 2026-07-27 · v0.1.1

### 환경

- macOS 15.6.1 arm64
- Node.js 20.18.0
- npm 10.8.2
- 로그인된 Codex CLI 0.141.0
- 사용자 파일이 없는 새 임시 작업 공간

### 검증 흐름

```bash
npm init -y
npm install github:ksungz/agent-bridge
npx agent-bridge help
npx agent-bridge init "공개 설치 검증"
npx agent-bridge ask codex \
  "Reply exactly: Agent Bridge public installation validation passed."
npx agent-bridge handoff codex
```

### 확인한 결과

- GitHub 설치와 CLI 도움말 실행이 완료됐다.
- 새 작업과 공통 기록 폴더가 생성됐다.
- 기존 로그인 상태를 사용하는 Codex CLI가 종료 코드 `0`으로 실행됐다.
- 요청 결과가 run Markdown에 저장됐다.
- 다음 도구에 전달할 handoff Markdown이 생성됐다.

### 검증 중 발견한 문제와 개선

Codex CLI가 표준 오류에 출력한 현재 사용자의 홈 디렉터리 절대 경로가
run 기록과 이를 인용한 handoff 문서에 그대로 포함됐다.

[`Issue #1`](https://github.com/ksungz/agent-bridge/issues/1)로 기록하고,
`v0.1.1`부터 저장 직전에 현재 사용자의 홈 디렉터리 경로를 `$HOME`으로 바꾸도록 수정했다.
프롬프트, 명령 인자, stdout과 stderr에 홈 경로가 포함된 경우를 자동 테스트에 추가했다.

### 현재 검증하지 않은 범위

- 외부 사용자의 설치와 반복 사용
- Claude Code와 Gemini CLI의 같은 시점 재실행
- 장시간 작업 기록의 크기와 요약 품질
- 프롬프트와 실행 결과에 포함될 수 있는 임의의 민감정보 자동 탐지

Agent Bridge는 홈 디렉터리 경로 외의 민감정보를 자동으로 제거하지 않는다.
작업 기록을 커밋하거나 공유하기 전에는 사용자가 직접 내용을 확인해야 한다.
