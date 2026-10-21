# Harmonic ADSR Analyzer

가산합성용 샘플 분석을 위해 만든 브라우저 기반 도구입니다. 오디오 파일을 넣으면 기음을 추정하고, 기음의 정수배 배음들에 대해 주파수, 피크 레벨, ADSR 근사값을 계산합니다.

## 사용 방법

1. `index.html`을 브라우저에서 엽니다.
2. WAV, MP3, AIFF, M4A 등 브라우저가 지원하는 오디오 파일을 넣습니다.
3. 자동 분석 결과를 확인하거나, 기음이 틀렸다면 `기음 수동 지정`에 Hz 값을 넣고 다시 분석합니다.
4. 필요한 배음 수와 민감도를 조절합니다.
5. `CSV` 또는 `JSON`으로 결과를 내보냅니다.

## 포함 기능

- 오디오 파형 표시
- 자동 기음 추정과 수동 기음 입력
- 배음별 주파수, 피크 레벨, ADSR 근사값 표시
- 평균 스펙트럼과 배음 마커
- CSV/JSON 내보내기

## 참고

ADSR은 원본 샘플에서 추정한 근사값입니다. MIDI note-off 정보가 없는 단일 오디오 파일에서는 실제 신시사이저의 release 시작점을 정확히 알 수 없으므로, 레벨이 마지막으로 내려가는 구간을 release로 추정합니다.

## Biquad Low-pass 실습

파일을 올리고 ▶를 누른 뒤 **원음 듣기 / 필터음 듣기**로 같은 재생 위치에서 비교합니다.
Cutoff는 20 Hz부터 20 kHz(장치 샘플레이트가 낮으면 나이퀴스트 아래)까지 로그 간격,
Q는 일반적인 무차원 Q 값 0.3–5입니다. 초기값은 1 kHz / Q = 1/√2이며 원음이 선택됩니다.
반복 재생과 공통 출력 음량(기본 −18 dB, 최대 −12 dB)을 제공합니다.
공진을 높이면 음량도 증가하므로 작은 재생 음량에서 시작하세요.

- 응답 그래프는 `getFrequencyResponse()`로 계산한 필터 자체의 정상상태 진폭 응답입니다.
- 오디오를 올리기 전에는 48 kHz 미리보기, 이후에는 실제 AudioContext 샘플레이트를 사용합니다.
- Spectrum의 보라 실선은 기존 원본 스펙트럼, 청록 점선은 원본 진폭 × 필터 응답의 예상값입니다.
  두 곡선은 원본 최대값을 공통 기준으로 사용합니다. 실제 출력 FFT가 아니며 과도응답을 표현하지 않습니다.
- 파형, 배음별 ADSR, 기음 추정 및 CSV/JSON은 계속 원본을 분석합니다.
- 재생 경로: Source → Dry gain / Low-pass → Wet gain → 공통 Output gain → Destination.
  두 경로의 gain을 25 ms 동안 전환하고 Cutoff/Q도 25 ms 동안 변경하여 급격한 변화를 줄입니다.
- Web Audio Low-pass의 `Q` 파라미터는 dB이므로 UI의 Q를 `20 * Math.log10(Q)`로 변환합니다.
  Q = 1/√2에서 설정 주파수의 응답은 약 −3.01 dB, Q = 2에서는 약 +6.02 dB입니다.
- 2차의 약 −12 dB/oct는 Cutoff보다 충분히 높고 나이퀴스트에서 떨어진 구간의 근사입니다.

수업 순서: Q 0.707에서 Cutoff를 내리기 → Cutoff를 고정하고 Q 올리기 → 원음과 비교하기 → 접힌 수식 설명 읽기.

기술 참고: [Web Audio BiquadFilterNode](https://webaudio.github.io/web-audio-api/#BiquadFilterNode),
[Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/).

## 검증

외부 런타임 의존성 없이 `index.html`로 실행합니다. 자동 브라우저 검증에는 개발 환경에 Playwright와 Chromium이 필요합니다.

```sh
python3 -m http.server 8000
# 다른 터미널에서 (Playwright 설치 환경)
node tests/filter-lab.cjs
```

검증 항목: native Web Audio 응답과 실제 OfflineAudioContext 렌더 비교, WAV 업로드,
ADSR 불변, A/B·반복·연속 재생·자연 종료, JSON 다운로드, 모바일 가로 넘침 및 브라우저 오류.

의존성 없는 연결·수학 검증은 `node tests/smoke.cjs`로 실행합니다. 이 검사는 DOM/Web Audio 대역과 독립적인 계수 계산을 사용하며 실제 브라우저 재생 검증을 대신하지 않습니다.
