// app.js — 할 일 관리 앱: 데이터 / 렌더링 / 이벤트 / 초기화

// ---------- 상수 & 상태 ----------

const STORAGE_KEY = "todos";

const CATEGORY_LABELS = {
    work: "업무",
    personal: "개인",
    study: "공부",
};

// 자동 분류용 키워드 — 텍스트에 포함된 키워드 수가 가장 많은 카테고리로 분류한다.
// 동률일 경우 객체 키 순회 순서(work → study → personal)가 우선순위 역할을 한다.
const CATEGORY_KEYWORDS = {
    work: [
        "회의", "미팅", "보고서", "보고", "이메일", "메일", "발표", "프로젝트",
        "클라이언트", "고객", "업무", "출장", "결재", "기획", "마감", "회사",
        "팀", "거래처", "계약",
    ],
    study: [
        "공부", "강의", "수업", "시험", "과제", "숙제", "학습", "독서", "책",
        "영어", "수학", "국어", "인강", "복습", "예습", "학원", "자격증",
        "토익", "토플", "코딩", "논문",
    ],
    personal: [
        "운동", "헬스", "요가", "산책", "조깅", "쇼핑", "장보기", "약속", "친구",
        "가족", "영화", "여행", "식사", "점심", "저녁", "아침", "병원", "청소",
        "빨래", "은행", "미용실",
    ],
};

// 자동 분류 매칭이 전혀 없을 때 사용할 기본 카테고리.
const AUTO_FALLBACK_CATEGORY = "personal";

// 키워드 사전을 매 호출마다 lowercase로 변환하지 않도록 미리 정규화한 사전을 만든다.
const CATEGORY_KEYWORDS_LC = Object.fromEntries(
    Object.entries(CATEGORY_KEYWORDS).map(([cat, kws]) => [
        cat,
        kws.map((kw) => kw.toLowerCase()),
    ])
);

// 자동 분류 힌트 갱신을 디바운스하기 위한 지연(ms).
const AUTO_HINT_DEBOUNCE_MS = 150;

// 입력 글자수 제한(HTML maxlength와 동일).
const INPUT_MAX_LENGTH = 200;

// Undo 토스트 노출 시간(ms).
const UNDO_TOAST_DURATION_MS = 5000;
const INFO_TOAST_DURATION_MS = 4000;

let currentFilter = "all";

// 메모리 상태 — localStorage는 초기 로드와 mutate 후 저장에만 사용한다.
let todosState = [];

// 자동 힌트 디바운스 타이머 핸들.
let autoHintTimer = null;

// 최근 추가된 todo id — 다음 렌더에서 등장 애니메이션을 한 번만 부여하기 위해 사용한다.
let recentlyAddedId = null;

// DOM 참조 — DOMContentLoaded에서 채워진다.
let todoListEl;
let todoInputEl;
let categorySelectEl;
let addButtonEl;
let progressBarEl;
let progressBarFillEl;
let progressTextEl;
let filterButtonEls;
let autoHintEl;
let inputCounterEl;
let emptyStateEl;
let toastContainerEl;

// ---------- 자동 카테고리 분류 ----------

// 텍스트를 카테고리별 키워드와 매칭해 가장 점수가 높은 카테고리를 반환한다.
// 0점이면 AUTO_FALLBACK_CATEGORY를 반환하고, 동률은 객체 키 순회 순서로 결정된다.
function classifyByKeywords(text) {
    if (!text) return AUTO_FALLBACK_CATEGORY;
    const lower = text.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS_LC)) {
        let score = 0;
        for (const kw of keywords) {
            if (lower.includes(kw)) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            best = category;
        }
    }
    if (bestScore === 0) return AUTO_FALLBACK_CATEGORY;
    return best;
}

// 셀렉트가 "auto"면 키워드 분류 결과로 치환, 아니면 원래 값 그대로 사용한다.
function resolveCategory(selectValue, text) {
    return selectValue === "auto" ? classifyByKeywords(text) : selectValue;
}

// ---------- 데이터 계층 ----------

// localStorage에서 할 일 배열을 불러온다. 손상된 JSON은 빈 배열로 복구한다.
function loadTodos() {
    let raw = null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
        console.warn("localStorage 접근 실패:", e);
        return [];
    }
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn("todos 데이터 손상, 빈 배열로 복구:", e);
        return [];
    }
}

// 현재 메모리 상태를 localStorage에 JSON으로 저장한다.
// 저장 실패 시(용량 초과, 프라이빗 모드 등) 사용자에게 토스트로 안내한다.
function saveTodos() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(todosState));
        return true;
    } catch (e) {
        console.warn("저장 실패:", e);
        showToast({
            message: "저장에 실패했습니다. 브라우저 저장 공간을 확인해 주세요.",
            type: "error",
            duration: INFO_TOAST_DURATION_MS,
        });
        return false;
    }
}

// ID 충돌을 피하기 위해 가능한 경우 crypto.randomUUID를 사용한다.
function generateId() {
    return (
        crypto.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
}

// 새 할 일을 만들어 메모리 상태에 추가하고 저장한다.
function addTodo(text, category) {
    const todo = {
        id: generateId(),
        text,
        category,
        completed: false,
        createdAt: new Date().toISOString(),
    };
    todosState.push(todo);
    saveTodos();
    return todo;
}

// id로 찾은 할 일의 텍스트와 카테고리를 갱신한다.
function updateTodo(id, newText, newCategory) {
    const todo = todosState.find((t) => t.id === id);
    if (!todo) return null;
    todo.text = newText;
    todo.category = newCategory;
    saveTodos();
    return todo;
}

// id에 해당하는 할 일을 메모리 상태에서 제거한다.
// 복구를 위해 제거된 항목과 그 인덱스를 반환한다.
function deleteTodo(id) {
    const idx = todosState.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const [removed] = todosState.splice(idx, 1);
    saveTodos();
    return { todo: removed, index: idx };
}

// 삭제 취소 — 원래 자리에 다시 끼워 넣고 저장한다.
function restoreTodo(todo, index) {
    const safeIndex = Math.min(Math.max(index, 0), todosState.length);
    todosState.splice(safeIndex, 0, todo);
    saveTodos();
}

// id에 해당하는 할 일의 완료 여부를 뒤집는다.
function toggleTodo(id) {
    const todo = todosState.find((t) => t.id === id);
    if (!todo) return null;
    todo.completed = !todo.completed;
    saveTodos();
    return todo;
}

// ---------- 토스트 ----------

// 단일 토스트 표시. action이 주어지면 버튼이 함께 노출된다.
function showToast({ message, action, duration = INFO_TOAST_DURATION_MS, type = "info" }) {
    if (!toastContainerEl) return null;

    const toast = document.createElement("div");
    toast.className = "toast" + (type === "error" ? " toast-error" : "");
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    const messageEl = document.createElement("span");
    messageEl.className = "toast-message";
    messageEl.textContent = message;
    toast.appendChild(messageEl);

    let timerId = null;
    const dismiss = () => {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
        if (!toast.isConnected) return;
        toast.classList.add("leaving");
        // 애니메이션 종료(또는 200ms) 후 제거.
        const remove = () => toast.remove();
        toast.addEventListener("animationend", remove, { once: true });
        setTimeout(remove, 250);
    };

    if (action && typeof action.onClick === "function") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toast-action";
        btn.textContent = action.label;
        btn.addEventListener("click", () => {
            try {
                action.onClick();
            } finally {
                dismiss();
            }
        });
        toast.appendChild(btn);
    }

    toastContainerEl.appendChild(toast);
    timerId = setTimeout(dismiss, duration);
    return { dismiss };
}

// ---------- 렌더링 ----------

// 현재 필터에 맞는 항목을 ul에 그리고, 빈 상태 안내와 진행률을 갱신한다.
function renderTodos() {
    const all = todosState;
    const visible = currentFilter === "all"
        ? all
        : all.filter((t) => t.category === currentFilter);

    if (visible.length === 0) {
        todoListEl.replaceChildren();
        todoListEl.hidden = true;
        if (emptyStateEl) {
            emptyStateEl.hidden = false;
            emptyStateEl.textContent = all.length === 0
                ? "아직 할 일이 없어요. 위에서 추가해보세요!"
                : "이 카테고리에는 할 일이 없어요.";
        }
    } else {
        if (emptyStateEl) emptyStateEl.hidden = true;
        todoListEl.hidden = false;
        const frag = document.createDocumentFragment();
        for (const todo of visible) {
            frag.appendChild(buildTodoItem(todo));
        }
        todoListEl.replaceChildren(frag);
    }

    // 등장 애니메이션은 한 번만 적용하고 즉시 토큰을 비운다.
    recentlyAddedId = null;
    updateProgress(all);
}

// 단일 할 일에 대한 li 요소를 만든다. 이벤트는 ul에 위임되어 있으므로 여기서는 바인딩하지 않는다.
function buildTodoItem(todo) {
    const li = document.createElement("li");
    li.className = "todo-item";
    if (todo.id === recentlyAddedId) {
        li.classList.add("just-added");
    }
    li.dataset.id = todo.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "todo-checkbox";
    checkbox.checked = todo.completed;
    checkbox.setAttribute(
        "aria-label",
        `'${todo.text}' ${todo.completed ? "완료 해제" : "완료"}`
    );

    const categoryEl = document.createElement("span");
    categoryEl.className = `category-label category-${todo.category}`;
    categoryEl.textContent = CATEGORY_LABELS[todo.category] ?? todo.category;

    const textEl = document.createElement("span");
    textEl.className = "todo-text";
    if (todo.completed) textEl.classList.add("completed");
    textEl.textContent = todo.text;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "edit-button";
    editBtn.textContent = "수정";
    editBtn.setAttribute("aria-label", `'${todo.text}' 수정`);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-button";
    deleteBtn.textContent = "삭제";
    deleteBtn.setAttribute("aria-label", `'${todo.text}' 삭제`);

    li.append(checkbox, categoryEl, textEl, editBtn, deleteBtn);
    return li;
}

// 전체 기준(필터 무관) 완료 비율로 프로그레스 바와 텍스트를 갱신한다.
function updateProgress(all = todosState) {
    const total = all.length;
    let done = 0;
    for (const t of all) if (t.completed) done++;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    progressBarFillEl.style.width = percent + "%";
    progressTextEl.textContent = `${done} / ${total} 완료 (${percent}%)`;
    if (progressBarEl) {
        progressBarEl.setAttribute("aria-valuenow", String(percent));
        progressBarEl.setAttribute(
            "aria-valuetext",
            `${done} / ${total} 완료 (${percent}%)`
        );
    }
}

// 활성 필터를 바꾸고 버튼의 active/aria-selected를 동기화한 뒤 다시 그린다.
function setFilter(filter) {
    currentFilter = filter;
    for (const btn of filterButtonEls) {
        const isActive = btn.dataset.filter === filter;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
        btn.tabIndex = isActive ? 0 : -1;
    }
    renderTodos();
}

// 글자수 카운터 갱신 — 90% 이상이면 강조.
function updateInputCounter() {
    if (!inputCounterEl) return;
    const len = todoInputEl.value.length;
    inputCounterEl.textContent = `${len} / ${INPUT_MAX_LENGTH}`;
    inputCounterEl.classList.toggle("near-limit", len >= INPUT_MAX_LENGTH * 0.9 && len < INPUT_MAX_LENGTH);
    inputCounterEl.classList.toggle("at-limit", len >= INPUT_MAX_LENGTH);
}

// ---------- 이벤트 핸들러 ----------

// 입력값을 검사 후 새 할 일을 추가한다 (빈 문자열은 무시).
// "자동" 선택 시 키워드 기반으로 카테고리를 결정해 저장한다.
function handleAdd() {
    const text = todoInputEl.value.trim();
    if (!text) return;
    const selectValue = categorySelectEl.value;
    const category = resolveCategory(selectValue, text);
    const todo = addTodo(text, category);
    recentlyAddedId = todo.id;
    todoInputEl.value = "";
    updateInputCounter();
    updateAutoHint();
    renderTodos();

    // 자동 분류가 적용된 경우(셀렉트가 "auto"였던 경우) 토스트로 결과를 알리고
    // 변경 버튼을 통해 인라인 편집으로 진입할 수 있게 한다.
    if (selectValue === "auto") {
        showToast({
            message: `${CATEGORY_LABELS[category]} 카테고리로 분류됨`,
            action: {
                label: "변경",
                onClick: () => {
                    const itemEl = todoListEl.querySelector(
                        `.todo-item[data-id="${todo.id}"]`
                    );
                    if (itemEl) {
                        const current = todosState.find((t) => t.id === todo.id);
                        if (current) startEdit(itemEl, current);
                    }
                },
            },
            duration: INFO_TOAST_DURATION_MS,
        });
    }

    // 연속 입력 편의를 위해 포커스 복귀.
    todoInputEl.focus();
}

// 입력 텍스트와 셀렉트 상태를 보고 자동 분류 미리보기 힌트를 갱신한다.
function updateAutoHint() {
    if (!autoHintEl) return;
    if (categorySelectEl.value !== "auto") {
        autoHintEl.hidden = true;
        return;
    }
    const text = todoInputEl.value.trim();
    if (!text) {
        autoHintEl.hidden = true;
        return;
    }
    const category = classifyByKeywords(text);
    autoHintEl.hidden = false;
    autoHintEl.textContent = `자동 분류: ${CATEGORY_LABELS[category]}`;
}

// 입력 이벤트 시 디바운스로 updateAutoHint 호출 빈도를 낮춘다.
function scheduleAutoHintUpdate() {
    if (autoHintTimer !== null) clearTimeout(autoHintTimer);
    autoHintTimer = setTimeout(() => {
        autoHintTimer = null;
        updateAutoHint();
    }, AUTO_HINT_DEBOUNCE_MS);
}

// 한국어 IME 조합 중인 Enter는 무시해야 한다.
// e.isComposing가 true이거나 keyCode 229이면 조합 확정용 Enter로 간주.
function isComposingEnter(e) {
    return e.isComposing === true || e.keyCode === 229;
}

// 위임된 ul 클릭 이벤트 처리 — 수정/삭제 버튼에 대응한다.
function handleListClick(e) {
    const itemEl = e.target.closest(".todo-item");
    if (!itemEl) return;
    const id = itemEl.dataset.id;
    if (!id) return;

    if (e.target.classList.contains("edit-button")) {
        const todo = todosState.find((t) => t.id === id);
        if (todo) startEdit(itemEl, todo);
    } else if (e.target.classList.contains("delete-button")) {
        const result = deleteTodo(id);
        renderTodos();
        if (result) {
            // 삭제 즉시 토스트 — 5초 안에 "되돌리기"로 복구할 수 있다.
            showToast({
                message: `'${truncate(result.todo.text, 24)}' 삭제됨`,
                action: {
                    label: "되돌리기",
                    onClick: () => {
                        restoreTodo(result.todo, result.index);
                        recentlyAddedId = result.todo.id;
                        renderTodos();
                    },
                },
                duration: UNDO_TOAST_DURATION_MS,
            });
        }
    }
}

// 위임된 ul change 이벤트 처리 — 체크박스 토글에 대응한다.
function handleListChange(e) {
    if (!e.target.classList.contains("todo-checkbox")) return;
    const itemEl = e.target.closest(".todo-item");
    if (!itemEl) return;
    const id = itemEl.dataset.id;
    if (!id) return;
    toggleTodo(id);
    renderTodos();
}

// 해당 li를 인라인 편집 UI로 교체하고 저장(Enter) / 취소(Esc) 동작을 연결한다.
function startEdit(li, todo) {
    li.innerHTML = "";
    li.classList.add("editing");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "edit-input";
    input.value = todo.text;
    input.maxLength = INPUT_MAX_LENGTH;
    input.setAttribute("aria-label", "할 일 내용 수정");

    const select = document.createElement("select");
    select.className = "edit-category";
    select.setAttribute("aria-label", "카테고리 변경");
    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "자동";
    select.appendChild(autoOpt);
    for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === todo.category) opt.selected = true;
        select.appendChild(opt);
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";

    const commit = () => {
        const newText = input.value.trim();
        if (!newText) return;
        const newCategory = resolveCategory(select.value, newText);
        updateTodo(todo.id, newText, newCategory);
        renderTodos();
    };

    const cancel = () => renderTodos();

    saveBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", cancel);

    // 입력 input과 select 모두에서 Enter/Esc 처리. IME 조합 Enter는 무시.
    const onEditKeydown = (e) => {
        if (e.key === "Enter") {
            if (isComposingEnter(e)) return;
            commit();
        } else if (e.key === "Escape") {
            cancel();
        }
    };
    input.addEventListener("keydown", onEditKeydown);
    select.addEventListener("keydown", onEditKeydown);

    li.append(input, select, saveBtn, cancelBtn);
    input.focus();
    input.select();
}

// 토스트 메시지에서 긴 텍스트를 줄여서 표시한다.
function truncate(s, max) {
    if (typeof s !== "string") return "";
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// 필터 탭 그룹의 좌/우 화살표 키 처리 — tablist 권장 패턴.
function handleFilterKeydown(e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") {
        return;
    }
    e.preventDefault();
    const buttons = Array.from(filterButtonEls);
    const currentIdx = buttons.findIndex((b) => b === document.activeElement);
    const lastIdx = buttons.length - 1;
    let nextIdx = currentIdx;
    if (e.key === "ArrowLeft") nextIdx = currentIdx <= 0 ? lastIdx : currentIdx - 1;
    else if (e.key === "ArrowRight") nextIdx = currentIdx >= lastIdx ? 0 : currentIdx + 1;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = lastIdx;
    const target = buttons[nextIdx];
    if (target) {
        target.focus();
        setFilter(target.dataset.filter);
    }
}

// ---------- 초기화 ----------

// 페이지 로드 시 DOM 참조를 채우고, 이벤트를 연결하고, 첫 렌더를 수행한다.
document.addEventListener("DOMContentLoaded", () => {
    todoListEl = document.getElementById("todo-list");
    todoInputEl = document.getElementById("todo-input");
    categorySelectEl = document.getElementById("category-select");
    addButtonEl = document.getElementById("add-button");
    progressBarEl = document.getElementById("progress-bar");
    progressBarFillEl = document.getElementById("progress-bar-fill");
    progressTextEl = document.getElementById("progress-text");
    filterButtonEls = document.querySelectorAll(".filter-button");
    autoHintEl = document.getElementById("auto-hint");
    inputCounterEl = document.getElementById("input-counter");
    emptyStateEl = document.getElementById("empty-state");
    toastContainerEl = document.getElementById("toast-container");

    // 메모리 상태를 한 번만 초기화한다.
    todosState = loadTodos();

    addButtonEl.addEventListener("click", handleAdd);
    todoInputEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        // 한국어 조합 중 Enter는 조합 확정 신호이므로 무시(중복 추가 버그 방지).
        if (isComposingEnter(e)) return;
        handleAdd();
    });
    todoInputEl.addEventListener("input", () => {
        updateInputCounter();
        scheduleAutoHintUpdate();
    });
    categorySelectEl.addEventListener("change", updateAutoHint);
    updateAutoHint();
    updateInputCounter();

    // ul에 1회만 위임 등록 — 매 렌더마다 li별 리스너를 새로 만들지 않는다.
    todoListEl.addEventListener("click", handleListClick);
    todoListEl.addEventListener("change", handleListChange);

    for (const btn of filterButtonEls) {
        btn.addEventListener("click", () => setFilter(btn.dataset.filter));
        btn.addEventListener("keydown", handleFilterKeydown);
    }

    setFilter(currentFilter);
});
