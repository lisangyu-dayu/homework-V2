# SymPy 子进程 runner（M6 完成实现）
# 协议：从 stdin 读一行 JSON 请求，写一行 JSON 响应到 stdout
# 请求示例：
#   {"op": "equivalent", "a": "(x+1)*(x-1)", "b": "x**2-1"}
# 响应示例：
#   {"ok": true, "result": {"equivalent": true, "canonicalA": "x**2-1", "canonicalB": "x**2-1"}}
import sys
import json

def handle(req: dict) -> dict:
    op = req.get("op")
    # TODO[M6]: import sympy; parse expr; branch by op
    # op ∈ { solve, simplify, equivalent }
    return {"ok": False, "error": f"not-implemented: {op}"}

def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = handle(req)
        except Exception as e:
            resp = {"ok": False, "error": f"exception: {e}"}
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
