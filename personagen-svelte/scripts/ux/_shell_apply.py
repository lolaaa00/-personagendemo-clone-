"""Helpers for moving a portal route onto PageShell. Audit tooling, not shipped."""
import io, re

def load(p): return io.open(p, encoding='utf-8').read()
def save(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

def add_import(s):
    if 'PageShell' in s: return s
    head = s[:s.index('</script>')]
    imports = list(re.finditer(r'^\timport .*?;[ \t]*$', head, re.M))
    assert imports, 'no imports found'
    last = imports[-1]
    return s[:last.end()] + "\n\timport PageShell from '$lib/components/ui/PageShell.svelte';" + s[last.end():]

def drop_head(s):
    s2 = re.sub(r'<svelte:head>\s*<title>[^<]*</title>\s*</svelte:head>\s*\n', '', s, count=1)
    assert s2 != s, 'svelte:head not matched'
    return s2

def close_wrapper(s):
    i = s.index('<style>')
    j = s.rindex('</div>', 0, i)
    return s[:j] + '</PageShell>' + s[j+len('</div>'):]

def drop_css(s, blocks):
    for b in blocks:
        assert s.count(b) == 1, (s.count(b), b[:60])
        s = s.replace(b, '', 1)
    return s

def sub1(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:70])
    return s.replace(old, new, 1)
