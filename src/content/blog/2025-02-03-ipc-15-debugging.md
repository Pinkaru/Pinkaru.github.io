---
title: "IPC 디버깅 - strace, ipcs, 메모리 누수 탐지"
date: 2025-02-03
tags: [IPC, Debugging, strace, valgrind, Linux, Tools]
description: "IPC 디버깅 마스터: strace로 시스템 콜 추적, ipcs/ipcrm으로 IPC 관리, 메모리 누수와 데드락 탐지 기법을 배웁니다."
---

## 들어가며

**IPC 디버깅**은 일반 프로그램보다 어렵습니다. 여러 프로세스가 관여하고, 타이밍 문제, 동기화 오류, 자원 누수가 발생하기 쉽기 때문입니다.

## strace - 시스템 콜 추적

### 기본 사용법

```bash
# 프로그램 실행과 함께 추적
strace ./my_ipc_program

# 실행 중인 프로세스 추적
strace -p <PID>

# 특정 시스템 콜만 추적
strace -e trace=mq_open,mq_send,mq_receive ./program

# IPC 관련 시스템 콜만
strace -e trace=ipc ./program

# 네트워크/소켓 시스템 콜
strace -e trace=network ./program
```

### 실전 예제

```c
// debug_example.c
#include <mqueue.h>
#include <stdio.h>

int main() {
    mqd_t mq = mq_open("/test", O_CREAT | O_RDWR, 0644, NULL);
    char msg[] = "hello";
    mq_send(mq, msg, sizeof(msg), 0);
    mq_close(mq);
    mq_unlink("/test");
    return 0;
}
```

```bash
gcc -o debug debug_example.c -lrt
strace -e trace=mq_open,mq_send,mq_close,mq_unlink ./debug

# 출력:
# mq_open("/test", O_RDWR|O_CREAT, 0644, NULL) = 3
# mq_send(3, "hello\0", 6, 0)              = 0
# mq_close(3)                               = 0
# mq_unlink("/test")                        = 0
```

### 타이밍 분석

```bash
# 각 시스템 콜의 소요 시간
strace -T ./program

# 출력:
# mq_send(3, ..., 6, 0) = 0 <0.000023>  ← 23μs
# read(4, ..., 1024)    = 5 <0.000018>  ← 18μs

# 시스템 콜 통계
strace -c ./program

# 출력:
# % time     seconds  usecs/call     calls    errors syscall
# ------ ----------- ----------- --------- --------- ----------------
#  45.00    0.000009           3         3           mq_send
#  30.00    0.000006           2         3           write
#  15.00    0.000003           3         1           mq_open
```

### 다중 프로세스 추적

```bash
# fork된 자식 프로세스도 추적
strace -f ./multi_process_program

# 각 프로세스를 별도 파일에 저장
strace -ff -o trace_output ./program

# trace_output.12345 (부모)
# trace_output.12346 (자식 1)
# trace_output.12347 (자식 2)
```

## ipcs/ipcrm - System V IPC 관리

### ipcs: IPC 목록 확인

```bash
# 모든 IPC 확인
ipcs -a

# 메시지 큐만
ipcs -q

# 공유 메모리만
ipcs -m

# 세마포어만
ipcs -s

# 상세 정보 (-i <id>)
ipcs -m -i 32768

# 출력:
# Shared memory Segment shmid=32768
# uid=1000  gid=1000  cuid=1000  cgid=1000
# mode=0600  access_perms=0600
# bytes=1024  lpid=12345  cpid=12346
# nattch=2  uid=1000  gid=1000
# ctime=Tue Feb  3 10:30:00 2025
```

### ipcrm: IPC 삭제

```bash
# 메시지 큐 삭제
ipcrm -q <msqid>

# 공유 메모리 삭제
ipcrm -m <shmid>

# 세마포어 삭제
ipcrm -s <semid>

# 모든 IPC 삭제 (현재 사용자 것만)
ipcrm -a

# 특정 키로 삭제
ipcrm -Q 0x61020001  # Message Queue key
ipcrm -M 0x61020002  # Shared Memory key
ipcrm -S 0x61020003  # Semaphore key
```

### 자동 정리 스크립트

```bash
#!/bin/bash
# cleanup_ipc.sh - 좀비 IPC 정리

USER=$(whoami)

# 내 IPC 목록
ipcs -q | grep $USER | awk '{print $2}' | while read id; do
    ipcrm -q $id
    echo "Removed message queue: $id"
done

ipcs -m | grep $USER | awk '{print $2}' | while read id; do
    ipcrm -m $id
    echo "Removed shared memory: $id"
done

ipcs -s | grep $USER | awk '{print $2}' | while read id; do
    ipcrm -s $id
    echo "Removed semaphore: $id"
done
```

## lsof - 열린 파일/소켓 확인

### POSIX IPC 추적

```bash
# 프로세스가 연 IPC 확인
lsof -p <PID> | grep -E 'shm|mqueue'

# 출력:
# my_prog 12345 user  3u   REG   0,23  1024  /dev/shm/my_shm
# my_prog 12345 user  4u   REG   0,24    80  /dev/mqueue/my_queue

# 모든 프로세스의 POSIX Shared Memory
lsof /dev/shm/

# Unix Socket 확인
lsof -U

# 특정 소켓 파일
lsof /tmp/my_socket
```

## valgrind - 메모리 누수 탐지

### 기본 사용

```c
// leak_example.c
#include <stdlib.h>
#include <sys/mman.h>

int main() {
    // 메모리 누수!
    void *ptr = mmap(NULL, 1024, PROT_READ | PROT_WRITE,
                     MAP_SHARED | MAP_ANONYMOUS, -1, 0);

    // munmap 잊음!
    return 0;
}
```

```bash
gcc -g -o leak leak_example.c
valgrind --leak-check=full --show-leak-kinds=all ./leak

# 출력:
# ==12345== LEAK SUMMARY:
# ==12345==    definitely lost: 0 bytes in 0 blocks
# ==12345==    indirectly lost: 0 bytes in 0 blocks
# ==12345==      possibly lost: 0 bytes in 0 blocks
# ==12345==    still reachable: 1,024 bytes in 1 blocks  ← mmap 누수
```

### IPC 자원 누수 탐지

```c
// ipc_leak_detector.c
#include <stdio.h>
#include <stdlib.h>
#include <mqueue.h>
#include <fcntl.h>

void check_ipc_leaks() {
    system("ls /dev/mqueue/ | wc -l > /tmp/mq_count");
    system("ls /dev/shm/ | wc -l > /tmp/shm_count");

    FILE *f = fopen("/tmp/mq_count", "r");
    int mq_count;
    fscanf(f, "%d", &mq_count);
    fclose(f);

    f = fopen("/tmp/shm_count", "r");
    int shm_count;
    fscanf(f, "%d", &shm_count);
    fclose(f);

    if (mq_count > 0 || shm_count > 0) {
        printf("⚠️ IPC 누수 감지!\n");
        printf("  Message Queues: %d\n", mq_count);
        printf("  Shared Memory: %d\n", shm_count);
    } else {
        printf("✅ IPC 정리 완료\n");
    }
}

int main() {
    // 테스트: 누수 발생
    mq_open("/leak_test", O_CREAT | O_RDWR, 0644, NULL);
    // mq_unlink 잊음!

    check_ipc_leaks();

    return 0;
}
```

## gdb - 대화형 디버깅

### 다중 프로세스 디버깅

```bash
# fork 후 부모 따라가기
gdb -ex "set follow-fork-mode parent" ./program

# fork 후 자식 따라가기
gdb -ex "set follow-fork-mode child" ./program

# 모든 프로세스에 브레이크포인트
gdb -ex "set detach-on-fork off" ./program
```

### IPC 상태 확인

```gdb
# gdb 세션
(gdb) break mq_send
(gdb) run

# 브레이크포인트에서
(gdb) print mq
# $1 = 3

(gdb) shell ls -l /dev/mqueue/
# 메시지 큐 목록 확인

(gdb) call mq_getattr(mq, &attr)
(gdb) print attr
# mq_attr 구조체 내용
```

## 일반적인 문제와 해결

### 1. 데드락 탐지

```c
// deadlock_detector.c
#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

pthread_mutex_t mutex1 = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t mutex2 = PTHREAD_MUTEX_INITIALIZER;

void* thread1(void* arg) {
    pthread_mutex_lock(&mutex1);
    printf("Thread 1: mutex1 획득\n");
    sleep(1);

    printf("Thread 1: mutex2 대기 중...\n");
    pthread_mutex_lock(&mutex2);  // 데드락!

    pthread_mutex_unlock(&mutex2);
    pthread_mutex_unlock(&mutex1);
    return NULL;
}

void* thread2(void* arg) {
    pthread_mutex_lock(&mutex2);
    printf("Thread 2: mutex2 획득\n");
    sleep(1);

    printf("Thread 2: mutex1 대기 중...\n");
    pthread_mutex_lock(&mutex1);  // 데드락!

    pthread_mutex_unlock(&mutex1);
    pthread_mutex_unlock(&mutex2);
    return NULL;
}

int main() {
    pthread_t t1, t2;

    pthread_create(&t1, NULL, thread1, NULL);
    pthread_create(&t2, NULL, thread2, NULL);

    sleep(3);
    printf("💀 데드락 발생! Ctrl+C로 종료하세요.\n");

    pthread_join(t1, NULL);
    pthread_join(t2, NULL);

    return 0;
}
```

```bash
gcc -g -o deadlock deadlock_detector.c -lpthread
./deadlock &

# gdb 연결
gdb -p $(pgrep deadlock)

# 모든 스레드 확인
(gdb) info threads

# 각 스레드의 백트레이스
(gdb) thread 1
(gdb) bt

(gdb) thread 2
(gdb) bt

# pthread_mutex_lock에서 멈춤 → 데드락!
```

### 2. Race Condition 탐지

```bash
# Helgrind: 스레드 오류 탐지
valgrind --tool=helgrind ./program

# 출력:
# ==12345== Possible data race during write of size 4 at 0x12345678
# ==12345==    at 0x4008A2: increment (race.c:10)
# ==12345==    by 0x4E4B6B9: start_thread (pthread_create.c:333)
```

### 3. Semaphore 상태 확인

```bash
# System V Semaphore 값 확인
ipcs -s

# semid를 알면
ipcs -s -i 32768

# 출력:
# Semaphore Array semid=32768
# uid=1000    gid=1000    cuid=1000   cgid=1000
# mode=0600, access_perms=0600
# nsems = 3
# otime = Tue Feb  3 10:30:00 2025
# ctime = Tue Feb  3 10:25:00 2025
#
# semnum     value      ncount     zcount
#      0         5           0          0
#      1         0           2          0  ← 2개 프로세스 대기!
#      2         3           0          0
```

## 성능 프로파일링

### perf: 시스템 전체 프로파일링

```bash
# IPC 관련 이벤트 측정
perf stat -e 'syscalls:sys_enter_mq_*' ./program

# 출력:
#  Performance counter stats for './program':
#
#         10,234      syscalls:sys_enter_mq_send
#         10,234      syscalls:sys_enter_mq_receive
#              1      syscalls:sys_enter_mq_open
#
#        1.234567 seconds time elapsed

# 핫스팟 찾기
perf record ./program
perf report
```

### 레이턴시 측정

```c
// latency_measure.c
#include <stdio.h>
#include <time.h>
#include <mqueue.h>

double get_time_ns() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e9 + ts.tv_nsec;
}

int main() {
    mqd_t mq = mq_open("/perf", O_CREAT | O_RDWR, 0644, NULL);

    char msg[64];
    double start, end;

    // 10000번 측정
    double total = 0;
    for (int i = 0; i < 10000; i++) {
        start = get_time_ns();
        mq_send(mq, msg, sizeof(msg), 0);
        mq_receive(mq, msg, sizeof(msg), NULL);
        end = get_time_ns();

        total += (end - start);
    }

    printf("평균 레이턴시: %.2f ns\n", total / 10000);

    mq_close(mq);
    mq_unlink("/perf");

    return 0;
}
```

## 로깅 Best Practices

### 구조화된 로깅

```c
// structured_logging.c
#include <stdio.h>
#include <syslog.h>
#include <time.h>

typedef enum {
    LOG_IPC_OPEN,
    LOG_IPC_SEND,
    LOG_IPC_RECV,
    LOG_IPC_CLOSE,
    LOG_IPC_ERROR
} ipc_event_t;

void log_ipc_event(ipc_event_t event, const char *name, const char *details) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);

    const char *event_str[] = {
        "OPEN", "SEND", "RECV", "CLOSE", "ERROR"
    };

    // JSON 형식 로그
    printf("{\"timestamp\":%ld.%09ld,\"event\":\"%s\",\"ipc\":\"%s\",\"details\":\"%s\"}\n",
           ts.tv_sec, ts.tv_nsec,
           event_str[event], name, details);

    // syslog도 함께
    openlog("myapp", LOG_PID, LOG_USER);
    syslog(LOG_INFO, "%s: %s - %s", event_str[event], name, details);
    closelog();
}

int main() {
    log_ipc_event(LOG_IPC_OPEN, "/myqueue", "priority=high");
    log_ipc_event(LOG_IPC_SEND, "/myqueue", "size=64");
    log_ipc_event(LOG_IPC_RECV, "/myqueue", "size=64");
    log_ipc_event(LOG_IPC_CLOSE, "/myqueue", "success");

    return 0;
}
```

## 디버깅 체크리스트

### 개발 중

```
✅ 컴파일 시
  [ ] -g 플래그로 디버그 심볼 포함
  [ ] -Wall -Wextra로 경고 활성화
  [ ] AddressSanitizer: -fsanitize=address

✅ 실행 시
  [ ] valgrind로 메모리 누수 확인
  [ ] strace로 시스템 콜 추적
  [ ] Helgrind로 Race Condition 탐지

✅ IPC 자원
  [ ] ipcs로 남은 자원 확인
  [ ] lsof로 열린 파일 확인
  [ ] 종료 시 정리 확인
```

### 프로덕션

```
✅ 모니터링
  [ ] syslog 설정
  [ ] 구조화된 로그 (JSON)
  [ ] 성능 메트릭 수집

✅ 디버깅
  [ ] Core dump 활성화
  [ ] strace 준비 (성능 영향 주의)
  [ ] gdb 원격 디버깅 설정

✅ 자동 복구
  [ ] Watchdog 프로세스
  [ ] IPC 자원 자동 정리
  [ ] 데드락 타임아웃
```

## 유용한 디버깅 도구

### 종합 비교

| 도구 | 용도 | 성능 영향 | 사용 난이도 |
|------|------|----------|------------|
| **strace** | 시스템 콜 추적 | 높음 (10-100x) | 쉬움 |
| **ltrace** | 라이브러리 함수 추적 | 높음 | 쉬움 |
| **gdb** | 대화형 디버깅 | 낮음 (브레이크 시만) | 중간 |
| **valgrind** | 메모리 오류 | 매우 높음 (20-50x) | 쉬움 |
| **perf** | 성능 프로파일링 | 낮음 | 중간 |
| **lsof** | 파일/소켓 확인 | 매우 낮음 | 쉬움 |
| **ipcs** | IPC 목록 | 매우 낮음 | 쉬움 |

## 다음 단계

IPC 디버깅을 마스터했습니다! 다음 글에서는:
- **고급 IPC 패턴** - Producer-Consumer 변형
- Master-Worker 패턴
- Pipeline과 Event-driven 아키텍처

---

**시리즈 목차**
1. IPC란 무엇인가
2. IPC 메커니즘 전체 개요
3. Pipe - 가장 기본적인 IPC
4. Named Pipe (FIFO)
5. Signal - 비동기 이벤트 통신
6. Shared Memory - 공유 메모리
7. Message Queue 심화
8. Semaphore 심화
9. Unix Domain Socket
10. Memory-Mapped Files
11. IPC 메커니즘 성능 비교
12. 동기화 기법
13. POSIX vs System V IPC
14. IPC 보안
15. **IPC 디버깅** ← 현재 글
16. 고급 IPC 패턴 (다음 글)

> 💡 **Quick Tip**: strace는 개발 시 필수 도구입니다. `-e trace=ipc`로 IPC 시스템 콜만 추적하고, `-c`로 통계를 확인하세요. 프로덕션에서는 성능 영향이 크므로 주의!
