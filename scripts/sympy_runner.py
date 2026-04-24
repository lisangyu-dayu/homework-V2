import json
import re
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
LOCAL_DICT = {
    "sqrt": sp.sqrt,
    "pi": sp.pi,
}
SUPERSCRIPT_TRANSLATION = str.maketrans({
    "⁰": "^0",
    "¹": "^1",
    "²": "^2",
    "³": "^3",
    "⁴": "^4",
    "⁵": "^5",
    "⁶": "^6",
    "⁷": "^7",
    "⁸": "^8",
    "⁹": "^9",
})


def to_half_width(source: str) -> str:
    chars: list[str] = []
    for char in source:
        code = ord(char)
        if code == 0x3000:
            chars.append(" ")
        elif 0xFF01 <= code <= 0xFF5E:
            chars.append(chr(code - 0xFEE0))
        else:
            chars.append(char)
    return "".join(chars)


def read_braced(text: str, start: int) -> tuple[str, int] | None:
    index = start
    while index < len(text) and text[index].isspace():
        index += 1
    if index >= len(text) or text[index] != "{":
        return None

    depth = 0
    content_start = index + 1
    for pos in range(index, len(text)):
        if text[pos] == "{":
            depth += 1
        elif text[pos] == "}":
            depth -= 1
            if depth == 0:
                return text[content_start:pos], pos + 1
    return None


def replace_latex_groups(text: str) -> str:
    for command in ("\\boxed", "\\mathrm", "\\text"):
        while command in text:
            start = text.find(command)
            group = read_braced(text, start + len(command))
            if group is None:
                break
            content, end = group
            text = text[:start] + content + text[end:]

    for command in ("\\frac", "\\dfrac", "\\tfrac"):
        while command in text:
            start = text.find(command)
            numerator = read_braced(text, start + len(command))
            if numerator is None:
                break
            numerator_text, numerator_end = numerator
            denominator = read_braced(text, numerator_end)
            if denominator is None:
                break
            denominator_text, denominator_end = denominator
            replacement = f"(({numerator_text})/({denominator_text}))"
            text = text[:start] + replacement + text[denominator_end:]

    while "\\sqrt" in text:
        start = text.find("\\sqrt")
        group = read_braced(text, start + len("\\sqrt"))
        if group is None:
            break
        content, end = group
        text = text[:start] + f"sqrt({content})" + text[end:]

    return text


def normalize_source(source: str) -> str:
    text = to_half_width(source).translate(SUPERSCRIPT_TRANSLATION).strip()
    text = text.replace("$", "")
    text = text.replace("\\left", "").replace("\\right", "")
    text = text.replace("\\cdot", "*").replace("\\times", "*").replace("\\div", "/")
    text = text.replace("\\pi", "pi")
    text = replace_latex_groups(text)

    replacements = {
        "×": "*",
        "·": "*",
        "÷": "/",
        "−": "-",
        "＝": "=",
        "≈": "=",
        "≃": "=",
        "≡": "=",
        "≤": "<=",
        "≥": ">=",
        "（": "(",
        "）": ")",
        "【": "(",
        "】": ")",
        "，": ",",
        "；": ";",
        "：": ":",
    }
    for original, replacement in replacements.items():
        text = text.replace(original, replacement)

    text = re.sub(r"^(?:答案|答|结果)\s*(?:是|为|等于|:|=)?\s*", "", text)
    text = re.sub(r"^(?:解|解得|所以|则|因此|故)\s*(?:[:=])?\s*", "", text)
    text = re.sub(r"([A-Za-z][A-Za-z0-9_]*)\s*的值\s*(?:是|为|等于)\s*", r"\1=", text)
    text = text.replace("等于", "=")
    text = re.sub(r"根号\s*([A-Za-z0-9_.]+)", r"sqrt(\1)", text)
    text = re.sub(r"([A-Za-z0-9_)]+)\s*的?平方", r"\1^2", text)
    text = re.sub(r"[\u4e00-\u9fff]+", "", text)

    text = text.replace("{", "(").replace("}", ")")
    text = text.replace("[", "(").replace("]", ")")
    text = re.sub(r"\s+", "", text)
    text = text.strip("。.;,")
    return text


def split_equation(source: str) -> tuple[str, str] | None:
    text = normalize_source(source)
    if "<=" in text or ">=" in text or "!=" in text:
        return None
    if text.count("=") != 1:
        return None
    left, right = text.split("=", 1)
    if not left or not right:
        return None
    return left, right


def parse_expr_text(source: str) -> sp.Expr:
    return parse_expr(
        source,
        local_dict=LOCAL_DICT,
        transformations=TRANSFORMATIONS,
    )


def parse_math(source: str) -> sp.Expr:
    text = normalize_source(source)
    if not text:
        raise ValueError("empty expression")

    equation = split_equation(text)
    if equation is not None:
        left, right = equation
        return sp.simplify(parse_expr_text(left) - parse_expr_text(right))

    return parse_expr_text(text)


def assignment_value(source: str) -> sp.Expr | None:
    equation = split_equation(source)
    if equation is None:
        return None
    left, right = equation
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", left):
        return parse_expr_text(right)
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", right):
        return parse_expr_text(left)
    return None


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


def same_equation_solution_set(a: str, b: str) -> bool:
    if split_equation(a) is None or split_equation(b) is None:
        return False
    try:
        return set(solve_equation(a)) == set(solve_equation(b))
    except Exception:
        return False


def numerically_equivalent(expr_a: sp.Expr, expr_b: sp.Expr) -> bool:
    symbols = sorted(expr_a.free_symbols.union(expr_b.free_symbols), key=lambda symbol: symbol.sort_key())
    if not symbols:
        return bool(abs(complex(sp.N(expr_a - expr_b))) <= NUMERIC_TOLERANCE)

    samples = (-3, -1, 1, 2, 3)
    for offset in range(len(samples)):
        substitutions = {
            symbol: samples[(offset + index) % len(samples)]
            for index, symbol in enumerate(symbols)
        }
        try:
            evaluated = sp.N((expr_a - expr_b).subs(substitutions))
            delta = abs(complex(evaluated))
        except Exception:
            return False
        if delta > NUMERIC_TOLERANCE:
            return False
    return True


def equivalent_parsed(expr_a: sp.Expr, expr_b: sp.Expr, note: str) -> dict[str, Any] | None:
    simplified_delta = sp.simplify(expr_a - expr_b)

    if simplified_delta == 0:
        return {
            "equivalent": True,
            "canonicalA": canonical(expr_a),
            "canonicalB": canonical(expr_b),
            "note": note,
        }

    if numerically_equivalent(expr_a, expr_b):
        return {
            "equivalent": True,
            "canonicalA": canonical(expr_a),
            "canonicalB": canonical(expr_b),
            "note": "numeric-match",
        }

    return None


def equivalent_expr(a: str, b: str) -> dict[str, Any]:
    if same_equation_solution_set(a, b):
        expr_a = parse_math(a)
        expr_b = parse_math(b)
        return {
            "equivalent": True,
            "canonicalA": canonical(expr_a),
            "canonicalB": canonical(expr_b),
            "note": "equation-solution-match",
        }

    expr_a = parse_math(a)
    expr_b = parse_math(b)
    direct_match = equivalent_parsed(expr_a, expr_b, "symbolic-match")
    if direct_match is not None:
        return direct_match

    value_a = assignment_value(a)
    value_b = assignment_value(b)
    if value_a is not None and split_equation(b) is None:
        assignment_match = equivalent_parsed(value_a, expr_b, "assignment-value-match")
        if assignment_match is not None:
            return assignment_match

    if value_b is not None and split_equation(a) is None:
        assignment_match = equivalent_parsed(expr_a, value_b, "assignment-value-match")
        if assignment_match is not None:
            return assignment_match

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
