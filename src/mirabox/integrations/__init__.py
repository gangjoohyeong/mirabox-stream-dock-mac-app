"""연동 모음.

여기서 불러오는 것만 등록된다. 새 연동을 붙이려면 모듈을 하나 만들고
아래에 한 줄 추가하면 된다.
"""

from . import atlassian, buildhost, claude, gitlab, google  # noqa: F401

__all__ = ["atlassian", "buildhost", "claude", "gitlab", "google"]
