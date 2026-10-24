"""Structured API errors: {"error": {"code", "message", "details"}, "request_id"}.
Codes are a stable contract for clients (mobile included); messages are for humans."""
from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None,
                 headers: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.details, self.headers = details or {}, headers or {}


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found")


def conflict(code: str, message: str, details: dict | None = None) -> ApiError:
    return ApiError(409, code, message, details)


def version_conflict(current: int, expected: int) -> ApiError:
    return ApiError(409, "version_conflict",
                    "The record changed since you loaded it. Refresh and retry.",
                    {"current_version": current, "expected_version": expected})


def check_version(row: dict, expected: int | None) -> None:
    if expected is not None and row["version"] != expected:
        raise version_conflict(row["version"], expected)
