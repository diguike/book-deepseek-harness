#!/usr/bin/env python3
"""第 11 章：前缀稳定性实验（真实 DeepSeek 端点）

原理：DeepSeek 的响应里带 prompt_cache_hit_tokens / prompt_cache_miss_tokens。
先用基线请求把缓存捂热，再每次只改一个变量，看命中掉多少。

用法：DEEPSEEK_API_KEY=... python3 assets/ch11/prefix-experiment.py
"""
import copy, json, os, sys, time, urllib.request

KEY = os.environ.get('DEEPSEEK_API_KEY')
if not KEY: sys.exit('需要 DEEPSEEK_API_KEY')
URL = 'https://api.deepseek.com/chat/completions'
MODEL = 'deepseek-v4-flash'

def call(body):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
    u = d.get('usage', {})
    return {
        'hit': u.get('prompt_cache_hit_tokens', 0),
        'miss': u.get('prompt_cache_miss_tokens', 0),
        'prompt': u.get('prompt_tokens', 0),
    }

# ── 基线：拿一份真实的 dsh 请求形状 ──
# system prompt 造得和 dsh 一个量级（约 4KB），工具 schema 25 个（约 27KB）
SYSTEM = ('You are an AI agent powered by DeepSeek Harness.\n\n' +
          'You help engineers work in their codebase. Follow these rules carefully.\n' * 40)

def mk_tool(name, desc):
    return {'type': 'function', 'function': {'name': name, 'description': desc,
        'parameters': {'type': 'object', 'properties': {
            'path': {'type': 'string', 'description': 'The absolute path to operate on. ' * 6},
            'pattern': {'type': 'string', 'description': 'A glob or regex pattern to match. ' * 6},
            'recursive': {'type': 'boolean', 'description': 'Whether to recurse into subdirectories. ' * 4},
        }, 'required': ['path']}}}

TOOLS = [mk_tool(n, f'Tool {n}. ' + 'Detailed behaviour description. ' * 12) for n in
         ['bash','read','write','edit','glob','grep','str_replace_editor','todo_write','web_search',
          'web_fetch','skill','subagent','report','job_list','job_output','job_kill','create_goal',
          'get_goal','update_goal','ralph','workflow','terminal_open','terminal_read','terminal_send','lsp']]

HISTORY = [{'role': 'user', 'content': '帮我看一下这个项目的结构。' + '需要详细的分析。' * 30}]

def base():
    return {'model': MODEL, 'max_tokens': 8,
            'messages': [{'role': 'system', 'content': SYSTEM}] + copy.deepcopy(HISTORY),
            'tools': copy.deepcopy(TOOLS)}

# ── 方法说明 ──
# 关键：每个变体必须测「基线已缓存的前提下，改动之后的**第一次**请求命中多少」。
# 如果对变体连发两次、读第二次，那测的是变体自己的缓存，不是基线的——第一版就错在这。
# 为避免各变体互相污染缓存，每个变体用一个独立的 salt，拥有自己的缓存谱系。

def salted(salt, **over):
    """带 salt 的基线。salt 放在 system 最前面，让这一支拥有独立的前缀。"""
    b = base()
    b['messages'][0]['content'] = f'[lineage {salt}]\n' + b['messages'][0]['content']
    return b

print('测基线自身（连发两次，第二次读稳定值）……')
call(salted('base')); time.sleep(2)
b = call(salted('base'))
print(f"基线：prompt={b['prompt']} 命中={b['hit']} 未命中={b['miss']}")
print(f"（尾部 {b['miss']} token 每次都要重算——缓存有最小粒度，末尾不足一块的部分不入缓存）\n")

NEW_TOOL = lambda: mk_tool('my_new_tool', 'A tool from a newly installed plugin. ' * 12)

def m_none(b): return b
def m_append_msg(b): b['messages'].append({'role': 'user', 'content': '再补充一个问题。'}); return b
def m_tool_end(b): b['tools'].append(NEW_TOOL()); return b
def m_tool_mid(b): b['tools'].insert(12, NEW_TOOL()); return b
def m_tool_head(b): b['tools'].insert(0, NEW_TOOL()); return b
def m_swap(b): b['tools'][0], b['tools'][1] = b['tools'][1], b['tools'][0]; return b
def m_desc_last(b):
    f = b['tools'][-1]['function']; f['description'] += '.'; return b
def m_sys_head(b):
    b['messages'][0]['content'] = '【当前权限：danger-full-access】\n' + b['messages'][0]['content']; return b
def m_sys_tail(b):
    b['messages'][0]['content'] = b['messages'][0]['content'] + '\n附注：一句无关紧要的话。'; return b
def m_model(b): b['model'] = 'deepseek-v4-pro'; return b

VARIANTS = [
    ('A  什么都不改',                m_none),
    ('B  末尾追加一条消息',           m_append_msg),
    ('C  system **末尾**加一行',      m_sys_tail),
    ('D  system **开头**插一行',      m_sys_head),
    ('E  工具加在**最末尾**',         m_tool_end),
    ('F  工具加在**正中间**',         m_tool_mid),
    ('G  工具加在**最前面**',         m_tool_head),
    ('H  前两个工具**换位置**',       m_swap),
    ('I  改最后一个工具描述**一个字**', m_desc_last),
    ('J  换一个**模型**',            m_model),
]

rows = []
print(f"{'变量':30s} {'命中':>8s} {'未命中':>8s} {'命中率':>8s}")
print('-' * 60)
for i, (name, mutate) in enumerate(VARIANTS):
    salt = f'lineage-{i:02d}'
    time.sleep(2)
    call(salted(salt))                 # 把这一支的基线捂热
    time.sleep(2)
    r = call(mutate(salted(salt)))     # 改动之后的**第一次**请求
    tot = r['hit'] + r['miss']
    rate = r['hit'] / tot * 100 if tot else 0
    rows.append({'variant': name, **r, 'hitRate': round(rate, 1)})
    print(f"{name:30s} {r['hit']:>8,} {r['miss']:>8,} {rate:>7.1f}%")

json.dump({'model': MODEL, 'measuredAt': time.strftime('%Y-%m-%d'),
           'method': '每个变体独立 salt；先捂热该支基线，再测改动后的第一次请求',
           'baseline': b, 'results': rows},
          open(os.path.join(os.path.dirname(__file__), 'prefix-experiment.json'), 'w'),
          ensure_ascii=False, indent=2)
print('\n已存 assets/ch11/prefix-experiment.json')
