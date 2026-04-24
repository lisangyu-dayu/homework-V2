import json
import sys
from typing import Any

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)
NUMERIC_TOLERANCE = 1e-9


def parse_math(source: str) -> sp.Expr:
    text = source.strip()
    if not text:
        raise ValueError("empty expression")

    if "=" in text:
        left, right = text.split("=", 1)
        return sp.simplify(parse_expr(left, transformations=TRANSFORMATIONS) - parse_expr(right, transformations=TRANSFORMATIONS))

    return parse_expr(text, transformations=TRANSFORMATIONS)


def canonical(expr: sp.Expr) -> str:
    return sp.sstr(sp.simplify(expr))


def solve_equation(equation: str) -> list[str]:
    expr = parse_math(equation)
    symbols = sorted(expr.free_symbols, key=lambda symbol: symbol.sort_key())

    if not symbols:
        simplified = sp.simplify(expr)
        return [sp.sstr(simplified)]

    solved = sp.solve(expr, symbols if len(symbols) > 1 else symbols[0], dict=True)
    if isinstance(solved, dict):
        solved = [solved]

    if solved and isinstance(solved, list) and isinstance(solved[0], dict):
        formatted: list[str] = []
        for item in solved:
            pairs = [f"{sp.sstr(key)}={sp.sstr(sp.simplify(value))}" for key, value in sorted(item.items(), key=lambda pair: pair[0].sort_key())]
            formatted.append(", ".join(pairs))
        return formatted

    if isinstance(solved, (list, tuple, set)):
        return [sp.sstr(sp.simplify(item)) for item in solved]

    return [sp.sstr(sp.simplify(solved))]


def simplify_expr(expr: str) -> str:
    return canonical(parse_math(expr))


def numerically_equivalent(expr_a: sp.Expr, expr_b: sp.Expr) -> bool:
    symbols = sorted(expr_a.free_symbols.union(expr_b.free_symbols), key=lambda symbol: symbol.sort_key())
    if not symbols:
        return bool(abs(complex(sp.N(expr_a - expr_b))) <= NUMERIC_TOLERANCE)

    samples = (-3, -1, 1, 2, 3)
    for sample in samples:
        substitutions = {symbol: sample for symbol in symbols}
        evaluated = sp.N((expr_a - expr_b).subs(substitutions))
        if abs(complex(evaluated)) > NUMERIC_TOLERANCE:
            return False
    return True


def equivalent_expr(a: str, b: str) -> dict[str, Any]:
    expr_a = parse_math(a)
    expr_b = parse_math(b)
    simplified_delta = sp.simplify(expr_a - expr_b)

    if simplified_delta == 0:
        return {
            "equivalent": True,
            "canonicalA": canonical(expr_a),
            "canonicalB": canonical(expr_b),
            "note": "symbolic-match",
        }

    if numerically_equivalent(expr_a, expr_b):
        return {
            "equivalent": True,
            "canonicalA": canonical(expr_a),
            "canonicalB": canonical(expr_b),
            "note": "numeric-match",
        }

    return {
        "equivalent": False,
        "canonicalA": canonical(expr_a),
        "canonicalB": canonical(expr_b),
        "note": "not-equivalent",
    }


def handle(req: dict[str, Any]) -> dict[str, Any]:
    op = req.get("op")
    if op == "equivalent":
        return {"ok": True, "result": equivalent_expr(str(req.get("a", "")), str(req.get("b", "")))}
    if op == "solve":
        return {"ok": True, "result": solve_equation(str(req.get("equation", "")))}
    if op == "simplify":
        return {"ok": True, "result": simplify_expr(str(req.get("expr", "")))}
    return {"ok": False, "error": f"unsupported-op: {op}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            resp = handle(req)
        except Exception as exc:  # pragma: no cover - protocol guard
            resp = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
