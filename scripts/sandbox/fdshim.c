// Test-only shim for the sandbox suite (scripts/sandbox/test.sh, DECISIONS D-022). neard raises
// its open-file limit to 65535 at start and exits if it cannot; cloud containers cap the hard limit
// at 20000. For RLIMIT_NOFILE this clamps the request to the hard limit instead of failing. The
// node keeps at most 3000 store files open (near-sandbox default), well under that.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/resource.h>

typedef int (*setrlimit_fn)(int, const struct rlimit *);

static int clamped(const char *name, int res, const struct rlimit *rl) {
  setrlimit_fn real = (setrlimit_fn)dlsym(RTLD_NEXT, name);
  if (res != RLIMIT_NOFILE) return real(res, rl);
  struct rlimit cur;
  getrlimit(RLIMIT_NOFILE, &cur);
  struct rlimit want = *rl;
  if (want.rlim_max > cur.rlim_max) want.rlim_max = cur.rlim_max;
  if (want.rlim_cur > want.rlim_max) want.rlim_cur = want.rlim_max;
  real(res, &want);
  return 0;
}
int setrlimit(__rlimit_resource_t res, const struct rlimit *rl) { return clamped("setrlimit", res, rl); }
int setrlimit64(__rlimit_resource_t res, const struct rlimit64 *rl) { return clamped("setrlimit64", res, (const struct rlimit *)rl); }
