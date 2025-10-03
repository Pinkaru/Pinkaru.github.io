# 기술 블로그 디자인 변경 완료

## 변경 사항 요약

### 1. 새로운 페이지 추가
- **카테고리 페이지** (`categories.html`): 기술별로 포스트를 분류하고 확인할 수 있는 페이지
- **포트폴리오 페이지** (`portfolio.html`): 프로젝트와 작업물을 전시하는 페이지

### 2. 네비게이션 메뉴 업데이트
기존:
- Archive
- Tags

변경 후:
- Archive
- **Categories** (신규)
- Tags
- **Portfolio** (신규)

### 3. 사이드바 위젯 개선
블로그를 기술 블로그답게 만들기 위해 사이드바를 변경했습니다:

**기존 위젯:**
- Recent Posts
- Sponsored (광고 이미지)
- Recommended Websites (외부 웹사이트 링크)

**변경 후:**
- Recent Posts
- **Categories** (주요 카테고리 5개 표시)
- **Popular Tags** (인기 태그 8개 표시)

### 4. 포스트 표시 개선
각 포스트 페이지에서 카테고리와 태그를 명확하게 표시:
- 포스트 제목 아래에 카테고리와 태그 표시
- 카테고리/태그를 클릭하면 해당 페이지로 이동
- 시각적으로 구분되는 스타일 적용

### 5. 기술적 개선
- `.gitignore` 추가: 빌드 아티팩트 제외
- `Gemfile` 수정: HTTPS로 변경하여 보안 개선
- `_config.yml` 업데이트: 카테고리 경로 활성화

## 사용 방법

### 포스트 작성 시 카테고리와 태그 추가
```yaml
---
layout: post
title: "포스트 제목"
date: 2024-03-01
tags: [Python, Django, Web]
categories: Web Development
---
```

### 포트폴리오 아이템 추가
```yaml
---
layout: post
title: "프로젝트 이름"
categories: Portfolio
tags: [React, Node.js]
---
```

## 추천 카테고리
- Web Development
- Mobile Development
- Data Science
- Machine Learning
- DevOps
- Portfolio
- Daily Report
- TIL (Today I Learned)

자세한 내용은 `GUIDE.md`를 참조하세요.
