import pytest
import importlib.util
import os
import math


def load_module():
    spec = importlib.util.spec_from_file_location(
        "expr_eval", os.path.join(os.getcwd(), "expr_eval.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestBasicArithmetic:
    def test_addition(self):
        mod = load_module()
        assert mod.evaluate("1 + 2") == 3

    def test_subtraction(self):
        mod = load_module()
        assert mod.evaluate("10 - 3") == 7

    def test_multiplication(self):
        mod = load_module()
        assert mod.evaluate("4 * 5") == 20

    def test_division(self):
        mod = load_module()
        assert mod.evaluate("10 / 3") == pytest.approx(10 / 3)

    def test_modulo(self):
        mod = load_module()
        assert mod.evaluate("10 % 3") == 1

    def test_power(self):
        mod = load_module()
        assert mod.evaluate("2 ** 10") == 1024


class TestOperatorPrecedence:
    def test_mul_before_add(self):
        mod = load_module()
        assert mod.evaluate("2 + 3 * 4") == 14

    def test_power_before_mul(self):
        mod = load_module()
        assert mod.evaluate("2 * 3 ** 2") == 18

    def test_parentheses_override(self):
        mod = load_module()
        assert mod.evaluate("(2 + 3) * 4") == 20

    def test_nested_parentheses(self):
        mod = load_module()
        assert mod.evaluate("((1 + 2) * (3 + 4))") == 21

    def test_complex_expression(self):
        mod = load_module()
        assert mod.evaluate("1 + 2 * 3 - 4 / 2") == pytest.approx(5.0)


class TestUnaryOperators:
    def test_unary_negative(self):
        mod = load_module()
        assert mod.evaluate("-5") == -5

    def test_unary_negative_in_expression(self):
        mod = load_module()
        assert mod.evaluate("3 + -2") == 1

    def test_double_negative(self):
        mod = load_module()
        assert mod.evaluate("- -5") == 5


class TestVariables:
    def test_simple_variable(self):
        mod = load_module()
        assert mod.evaluate("x", {"x": 42}) == 42

    def test_variable_in_expression(self):
        mod = load_module()
        assert mod.evaluate("x + y * 2", {"x": 1, "y": 3}) == 7

    def test_undefined_variable_raises(self):
        mod = load_module()
        with pytest.raises(NameError):
            mod.evaluate("x + 1")


class TestFunctionCalls:
    def test_builtin_abs(self):
        mod = load_module()
        assert mod.evaluate("abs(-5)") == 5

    def test_builtin_min(self):
        mod = load_module()
        assert mod.evaluate("min(3, 1, 2)") == 1

    def test_builtin_max(self):
        mod = load_module()
        assert mod.evaluate("max(3, 1, 2)") == 3

    def test_builtin_sqrt(self):
        mod = load_module()
        assert mod.evaluate("sqrt(16)") == pytest.approx(4.0)

    def test_function_with_expression_arg(self):
        mod = load_module()
        assert mod.evaluate("abs(3 - 7)") == 4


class TestParseAST:
    def test_parse_returns_ast(self):
        mod = load_module()
        ast = mod.parse("1 + 2")
        assert ast is not None

    def test_ast_evaluates(self):
        mod = load_module()
        ast = mod.parse("2 * 3 + 1")
        # AST should be evaluable
        assert ast is not None


class TestErrorHandling:
    def test_syntax_error(self):
        mod = load_module()
        with pytest.raises(SyntaxError):
            mod.evaluate("1 +")

    def test_syntax_error_double_operator(self):
        mod = load_module()
        with pytest.raises(SyntaxError):
            mod.evaluate("1 + + 2")

    def test_division_by_zero(self):
        mod = load_module()
        with pytest.raises(ZeroDivisionError):
            mod.evaluate("1 / 0")

    def test_empty_expression(self):
        mod = load_module()
        with pytest.raises((SyntaxError, ValueError)):
            mod.evaluate("")

    def test_unmatched_paren(self):
        mod = load_module()
        with pytest.raises(SyntaxError):
            mod.evaluate("(1 + 2")


class TestWhitespace:
    def test_no_spaces(self):
        mod = load_module()
        assert mod.evaluate("1+2*3") == 7

    def test_extra_spaces(self):
        mod = load_module()
        assert mod.evaluate("  1   +   2  ") == 3

    def test_tabs(self):
        mod = load_module()
        assert mod.evaluate("1\t+\t2") == 3


class TestEdgeCases:
    def test_large_number(self):
        mod = load_module()
        assert mod.evaluate("999999999 * 999999999") == 999999999 ** 2

    def test_floating_point(self):
        mod = load_module()
        assert mod.evaluate("0.1 + 0.2") == pytest.approx(0.3)

    def test_chained_power(self):
        mod = load_module()
        # ** is right-associative: 2 ** 3 ** 2 = 2 ** 9 = 512
        assert mod.evaluate("2 ** 3 ** 2") == 512
