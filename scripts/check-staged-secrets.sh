#!/usr/bin/env bash
# commit 前檢查 staged 內容裡「新增」的祕密（由 .husky/pre-commit 呼叫）。
#
# - GitHub token 直接擋：ghp_（classic PAT）、gho_（OAuth：app 的 Device Flow 產生的就是這種）、ghu_、ghs_、ghr_，
#   以及 fine-grained 的 github_pat_。
# - 寫死的 password／api_key／secret 只警告：測試資料與文件範例常長這樣，擋下來誤判太多。
# - 只看新增的行：修補外洩就是刪掉那行，連刪除的行也比對的話，修補本身會被擋。純改名沒有新增的行，不擋。
# - 只印檔名、不印內容：命中的那行就是祕密本身，印出來等於再外洩一次（終端機記錄、IDE 的 commit 視窗）。
# - 已知限制：只認 ASCII 相容的編碼（UTF-8、Big5、Latin-1…），UTF-16／UTF-32 的檔（例如 Windows PowerShell 5.1
#   用 > 重導向寫出來的）裡的 token 看不到。
set -euo pipefail

# 檔名一律當字面路徑：以 : 開頭的是 pathspec magic、含 [ ] * 的是萬用字元，逐檔查的時候會對到別的檔或什麼都對不到
export GIT_LITERAL_PATHSPECS=1

token_pattern='gh[opusr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}'
credential_pattern="(password|api[_-]?key|secret)[[:space:]]*=[[:space:]]*['\"][^'\"]+['\"]"

# 暫存檔裡就是 staged 的祕密：放在只有自己讀得到的暫存目錄，結束（含 Ctrl-C）時整個刪掉。
# 明確給樣板：macOS 的 mktemp -d 沒給樣板時不看 TMPDIR
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-staged-secrets.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
diff_file="$work_dir/diff"

# diff 先寫進暫存檔，不接管線：git 自己出錯時 set -e 會中止，不會被當成「沒找到」而放行。
# 一律要 unified diff 的文字：外部 diff 工具、textconv、binary 屬性、含 NUL 的檔案、強制上色，
# 都會讓 git diff 不給以 + 開頭的新增行。-M：純改名不算新增，不受使用者的 diff.renames 設定影響
staged_diff() {
  git diff --cached --no-color --no-ext-diff --no-textconv --text -M --unified=0 "$@" > "$diff_file"
}

# 新增的行在 unified diff 裡以 + 開頭。
# - LC_ALL=C：逐位元組比對。UTF-8 locale 下 . 不會跨過無效的位元組，token 前面同一行有 Big5、Latin-1 之類的字元就會漏掉。
# - -a：GNU grep（Linux、Git for Windows）判定是 binary 後會把 NUL 當換行，NUL 後面同一行的 token 就沒有行首的 +。
# - 結束碼 2 是 grep 自己出錯，不能當成「沒找到」而放行。
added_lines_match() {
  local rc=0
  LC_ALL=C grep -aq "$1" "^\+.*($2)" "$diff_file" || rc=$?
  if [ "$rc" -gt 1 ]; then
    exit "$rc"
  fi
  return "$rc"
}

staged_diff
has_token=false
has_credential=false
if added_lines_match -E "$token_pattern"; then has_token=true; fi
if added_lines_match -iE "$credential_pattern"; then has_credential=true; fi

# 有命中才逐檔找出是哪些檔：沒命中時整個檢查只呼叫一次 git，大的 commit 不會被逐檔呼叫拖慢。
# 改名的檔要把新舊路徑一起給 git 才配得成對；只給新路徑的話整份算新增，原本就在的 token 也會被算進去。
# 列檔名這次 git 在 process substitution 裡，失敗時 set -e 接不到：要不要擋、要不要警告只看上面整份掃描的結果，
# 逐檔只決定列哪些檔名，列不出來就印「找不出是哪個檔」
tokens=""
credentials=""
if $has_token || $has_credential; then
  while IFS= read -r -d '' status; do
    IFS= read -r -d '' file
    case "$status" in
      R* | C*)
        old="$file"
        IFS= read -r -d '' file
        staged_diff -- "$old" "$file"
        ;;
      *) staged_diff -- "$file" ;;
    esac
    if $has_token && added_lines_match -E "$token_pattern"; then
      tokens="${tokens}   ${file}"$'\n'
    fi
    if $has_credential && added_lines_match -iE "$credential_pattern"; then
      credentials="${credentials}   ${file}"$'\n'
    fi
  done < <(git diff --cached --name-status -M -z)
fi

unknown_files="   （找不出是哪個檔，請檢查 git diff --cached）"$'\n'

if $has_credential; then
  echo "⚠️  警告：下列檔案新增的內容裡有寫死的 password／api_key／secret，請確認不是真實的憑證（只警告、不擋）："
  [ -n "$credentials" ] || credentials="$unknown_files"
  printf '%s' "$credentials"
fi

if $has_token; then
  echo "❌ 錯誤：下列檔案新增的內容裡有疑似 GitHub token（不印出內容，免得再外洩一次）："
  # 整份 diff 有 token、逐檔卻一個都對不到時照樣擋：列不出是哪個檔不代表沒有
  [ -n "$tokens" ] || tokens="$unknown_files"
  printf '%s' "$tokens"
  echo "   請勿提交真實的 token：移除後重新 git add"
  exit 1
fi
