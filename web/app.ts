export {};
interface User { id: number; name: string; email: string; }
interface Post { id: number; title: string; content: string; published: boolean; createdAt: string; updatedAt: string; }
interface LoginResponse { user: User; accessToken: string; expiresIn: number; }
type Filter = 'all' | 'published' | 'draft';
const $ = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
};
const main = $<HTMLElement>('#main');
const authDialog = $<HTMLDialogElement>('#auth-dialog');
const editorDialog = $<HTMLDialogElement>('#editor-dialog');
const deleteDialog = $<HTMLDialogElement>('#delete-dialog');
const authForm = $<HTMLFormElement>('#auth-form');
const editorForm = $<HTMLFormElement>('#editor-form');
let session: { token: string; user: User } | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let routeVersion = 0;
let list: Post[] = [];
let mine: Post[] = [];
let filter: Filter = 'all';
let query = '';
let authMode: 'login' | 'register' = 'login';
let afterAuth: 'write' | 'studio' | null = null;
let editing: Post | null = null;
let deleting: Post | null = null;
let editorBaseline = '';
let authBusy = false;
let editorBusy = false;
let deleteBusy = false;
let currentPost: Post | null = null;
const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const date = (value: string): string => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const readTime = (post: Post): number => Math.max(1, Math.ceil(post.content.length / 500));
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function toast(message: string): void {
    const element = $('#toast'); element.textContent = message; element.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
}
function formError(id: string, message = ''): void { const node = $(id); node.textContent = message; node.hidden = !message; }
function message(error: unknown): string {
    if (!(error instanceof ApiError)) return '接続できませんでした。通信環境を確認して、もう一度お試しください。';
    if (error.status === 401) return 'メールアドレスまたはパスワードをご確認ください。';
    if (error.status === 403) return 'この記事を変更する権限がありません。';
    if (error.status === 404) return '記事が見つからないか、公開されていません。';
    if (error.status === 409) return 'このメールアドレスはすでに登録されています。';
    if (error.status === 429) return '試行回数の上限に達しました。1分ほど待ってからお試しください。';
    if (error.status === 413) return '入力内容が大きすぎます。本文を短くしてお試しください。';
    if (error.status === 400) return '入力内容をご確認ください。空白だけの入力は保存できません。';
    return '処理に失敗しました。少し時間をおいて再度お試しください。';
}
async function api<T>(path: string, method = 'GET', body?: unknown, protectedRequest = false): Promise<T> {
    if (protectedRequest && !session) throw new ApiError(401, 'Session required');
    const token = session?.token;
    const response = await fetch(path, { method, cache: 'no-store', headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(protectedRequest && token ? { Authorization: `Bearer ${token}` } : {})
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
        if (response.status === 401 && protectedRequest && token === session?.token) expireSession();
        throw new ApiError(response.status, response.statusText);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}
function resetSession(): void {
    clearTimeout(expiryTimer); session = null; mine = []; updateHeader();
}
function expireSession(): void {
    resetSession();
    // Retain an unsaved editor so the user can copy their text before logging in again.
    toast('ログインの有効期限が切れました。もう一度ログインしてください。');
    void render();
}
function updateHeader(): void {
    $('#account-actions').innerHTML = session
        ? `<span class="account-name">${esc(session.user.name)} さん</span><button class="text-button" data-action="logout" type="button">ログアウト</button><button class="button primary" data-action="write" type="button">記事を書く <span aria-hidden="true">＋</span></button>`
        : '<button class="text-button" data-action="login" type="button">ログイン</button><button class="button primary" data-action="register" type="button">はじめる <span aria-hidden="true">↗</span></button>';
}
function navigate(hash: string): void { if (location.hash === hash) void render(); else location.hash = hash; }
function loading(): void { main.innerHTML = '<div class="loading-state" role="status"><span class="loading-line"></span>ページを読み込んでいます…</div>'; }
function errorPage(error: unknown): void {
    const missing = error instanceof ApiError && error.status === 404;
    main.innerHTML = `<div class="page error-state"><span class="eyebrow">${missing ? 'PAGE NOT FOUND' : 'PLEASE TRY AGAIN'}</span><h1>${missing ? 'このページは見つかりませんでした。' : 'うまく読み込めませんでした。'}</h1><p>${esc(message(error))}</p><button class="button secondary" data-action="retry">もう一度読み込む</button> <a class="button primary" href="#/">記事一覧へ</a></div>`;
}
const sideNote = `<aside><div class="side-note"><span class="eyebrow">ABOUT THIS JOURNAL</span><div class="little-symbol" aria-hidden="true">余</div><h3>思考に、小さな余白を。</h3><p>試してみたこと。<br>うまくいかなかったこと。<br>ふと、気づいたこと。<br><br>日々のかけらを書き留めて、<br>次の一歩につなげていく。<br>ここは、そんな記録の場所です。</p><div class="small-rule"></div><span class="note-sign">Keep making, keep writing.</span></div><p class="side-bottom"><span>A NOTE TO YOUR FUTURE SELF</span>完璧な文章でなくても。<br>今日のあなたの言葉で。</p></aside>`;
function toolbar(studio: boolean): string {
    return `<div class="list-toolbar"><div class="tabs" role="tablist" aria-label="記事の表示"><button class="tab" role="tab" aria-selected="true" data-filter="all">${studio ? 'すべて' : 'すべての記事'}</button>${studio ? '<button class="tab" role="tab" aria-selected="false" data-filter="published">公開済み</button><button class="tab" role="tab" aria-selected="false" data-filter="draft">下書き</button>' : ''}</div><label class="search-box"><span hidden>記事を検索</span><input id="search" type="search" placeholder="記事を検索" aria-label="記事を検索"></label></div><div id="post-list" role="tabpanel" aria-label="記事一覧"></div>`;
}
function renderList(studio: boolean): void {
    const filtered = list.filter(post => (filter === 'all' || (filter === 'published' ? post.published : !post.published)) &&
        `${post.title}\n${post.content}`.toLocaleLowerCase('ja').includes(query.toLocaleLowerCase('ja')));
    const container = $('#post-list');
    const count = document.querySelector('#post-count'); if (count) count.textContent = `${filtered.length} ARTICLES`;
    if (!filtered.length) {
        container.innerHTML = `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">${query ? '⌕' : '一'}</span><h3>${query ? '見つかりませんでした。' : studio ? 'ここから、書き始めよう。' : '最初のページは、これから。'}</h3><p>${query ? '別の言葉で検索してみてください。' : studio ? '小さな気づきを、ひとつの記事に。<br>まずは自分だけの下書きからでも。' : 'まだ公開された記事はありません。<br>日々の気づきを、あなたの言葉で残してみませんか。'}</p>${query ? '<button class="text-button" data-action="clear-search">検索をクリアする</button>' : '<button class="text-button" data-action="write">最初の記事を書く <span aria-hidden="true">→</span></button>'}</div>`;
        return;
    }
    container.innerHTML = filtered.map((post, index) => `<a class="post-card" href="#/${studio ? 'studio/' : 'posts/'}${post.id}"><span class="post-index" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div><div class="post-meta"><span class="badge ${post.published ? '' : 'draft'}">${post.published ? '公開記事' : '下書き'}</span><time datetime="${esc(post.createdAt)}">${date(post.createdAt)}</time><span>約${readTime(post)}分で読めます</span></div><h3>${esc(post.title)}</h3><p>${esc(post.content)}</p></div><span class="read-arrow" aria-hidden="true">↗</span></a>`).join('');
}
async function render(): Promise<void> {
    const version = ++routeVersion;
    const hash = location.hash || '#/';
    const studio = hash === '#/studio';
    currentPost = null; filter = 'all'; query = '';
    document.querySelectorAll<HTMLElement>('[data-nav]').forEach(link => {
        const active = link.dataset.nav === (hash.startsWith('#/studio') ? 'studio' : 'journal');
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    document.title = '余白 — つくる日々の記録';
    if (hash === '#main') { main.focus(); return; }
    if (studio && !session || hash.startsWith('#/studio/') && !session) {
        main.innerHTML = `<div class="page signin-wall"><span class="eyebrow">YOUR WRITING STUDIO</span><h1>あなたの言葉を、育てる場所。</h1><p>ログインすると、公開した記事や<br>自分だけの下書きをまとめて管理できます。</p><button class="button primary" data-action="studio-login">ログインして続ける <span aria-hidden="true">→</span></button><p><button class="text-button" data-action="register">はじめての方はこちら</button></p></div>`;
        return;
    }
    loading();
    try {
        if (hash === '#/' || studio) {
            const posts = await api<Post[]>(studio ? '/api/me/posts' : '/api/posts', 'GET', undefined, studio);
            if (version !== routeVersion) return;
            list = posts; if (studio) mine = posts;
            main.innerHTML = studio
                ? `<div class="page"><div class="studio-heading"><div><span class="eyebrow">YOUR WRITING STUDIO</span><h1>自分の記事</h1><p>${esc(session?.user.name)} さんの、これまでと、これから。</p></div><button class="button primary" data-action="write">新しい記事を書く <span aria-hidden="true">＋</span></button></div><section class="studio-content" aria-label="自分の記事">${toolbar(true)}<p class="private-note">下書きはあなたにだけ表示されます。</p></section></div>`
                : `<div class="page"><section class="hero"><div class="hero-copy"><span class="eyebrow">WORDS, IDEAS & LITTLE DISCOVERIES</span><h1>つくる日々を、<br><em>書き残す。</em></h1><p>日々の学びと、小さな気づき。<br>書くことで見えてくる、次の一歩がある。</p><div class="hero-bottom"><button class="button primary" data-action="write">あなたも書いてみる <span class="arrow" aria-hidden="true">↗</span></button><span class="hero-note">ひとつの気づきから、はじめよう。</span></div></div><div class="hero-visual"><img src="/assets/journal.svg" width="520" height="440" alt="ノートと鉛筆、伸びゆく緑の枝のイラスト"><span class="visual-caption" aria-hidden="true">LEAVE A LITTLE ROOM FOR IDEAS.</span></div></section><div class="content-layout"><section aria-labelledby="latest-title"><div class="section-title"><h2 id="latest-title">新しい記録</h2><span class="count" id="post-count"></span><span class="mini-en">LATEST STORIES</span></div>${toolbar(false)}</section>${sideNote}</div></div>`;
            renderList(studio);
        } else {
            const match = /^#\/(posts|studio)\/([1-9]\d*)$/.exec(hash);
            if (!match) throw new ApiError(404, 'Unknown route');
            const own = match[1] === 'studio';
            const post = await api<Post>(`${own ? '/api/me/posts' : '/api/posts'}/${match[2]}`, 'GET', undefined, own);
            let canEdit = own;
            if (!own && session) {
                mine = await api<Post[]>('/api/me/posts', 'GET', undefined, true);
                canEdit = mine.some(item => item.id === post.id);
            }
            if (version !== routeVersion) return;
            currentPost = post;
            document.title = `${post.title} — 余白`;
            main.innerHTML = `<article class="article-page"><a class="back-link" href="#/${own ? 'studio' : ''}"><span aria-hidden="true">←</span> ${own ? '自分の記事' : '記事一覧'}に戻る</a><header class="article-header"><span class="eyebrow">${post.published ? 'A PAGE FROM THE JOURNAL' : 'A THOUGHT IN PROGRESS'}</span><h1>${esc(post.title)}</h1><div class="post-meta"><span class="badge ${post.published ? '' : 'draft'}">${post.published ? '公開記事' : '自分だけの下書き'}</span><time datetime="${esc(post.createdAt)}">${date(post.createdAt)}</time><span>約${readTime(post)}分で読めます</span><span>更新 ${date(post.updatedAt)}</span></div></header><div class="article-content">${esc(post.content)}</div><div class="article-end" aria-hidden="true">余</div>${canEdit ? '<div class="article-actions"><button class="button primary" data-action="edit">記事を編集する</button><button class="button secondary" data-action="delete">削除する</button></div>' : ''}</article>`;
        }
    } catch (error) { if (version === routeVersion) errorPage(error); }
}
function showAuth(mode: 'login' | 'register', intention: 'write' | 'studio' | null = null): void {
    afterAuth = intention;
    authForm.reset(); setAuthMode(mode);
    if (!authDialog.open) authDialog.showModal();
    const first = authForm.elements.namedItem(mode === 'register' ? 'name' : 'email');
    if (first instanceof HTMLInputElement) first.focus();
}
function setAuthMode(mode: 'login' | 'register'): void {
    authMode = mode; const register = mode === 'register';
    $('#auth-title').textContent = register ? 'あなたの余白を、ここに。' : 'おかえりなさい。';
    $('#auth-description').textContent = register ? '小さな気づきを、書き残す毎日へ。' : '続きを、ここから。';
    $('#name-field').hidden = !register;
    const name = authForm.elements.namedItem('name') as HTMLInputElement; name.required = register; name.disabled = !register;
    const password = authForm.elements.namedItem('password') as HTMLInputElement; password.autocomplete = register ? 'new-password' : 'current-password';
    $('#auth-submit').textContent = register ? 'アカウントを作成する' : 'ログイン';
    $('#auth-switch-label').textContent = register ? 'アカウントをお持ちの方は' : 'はじめての方は';
    $('[data-action="switch-auth"]').textContent = register ? 'ログイン' : 'アカウントを作成';
    formError('#auth-error');
}
function editorSnapshot(): string { return JSON.stringify([...new FormData(editorForm).entries()]); }
function closeEditor(): void {
    if (editorBusy) return;
    if (editorSnapshot() !== editorBaseline && !window.confirm('保存していない変更があります。閉じてもよいですか？')) return;
    editorDialog.close(); editorForm.reset(); editing = null;
}
function showEditor(post: Post | null = null): void {
    if (!session) { showAuth('login', 'write'); return; }
    editing = post; editorForm.reset(); formError('#editor-error');
    (editorForm.elements.namedItem('title') as HTMLInputElement).value = post?.title ?? '';
    (editorForm.elements.namedItem('content') as HTMLTextAreaElement).value = post?.content ?? '';
    (editorForm.elements.namedItem('published') as HTMLInputElement).checked = post?.published ?? false;
    $('#editor-title').textContent = post ? '記事を編集する' : '新しい記事を書く';
    $('#character-count').textContent = `${post?.content.length ?? 0}文字`;
    editorBaseline = editorSnapshot(); editorDialog.showModal();
    (editorForm.elements.namedItem('title') as HTMLInputElement).focus();
}
authForm.addEventListener('submit', async event => {
    event.preventDefault(); if (authBusy) return;
    const values = new FormData(authForm);
    const email = String(values.get('email') ?? '').trim();
    const password = String(values.get('password') ?? '');
    if (new TextEncoder().encode(password).length > 128) { formError('#auth-error', 'パスワードはUTF-8で128バイト以内にしてください。'); return; }
    const register = authMode === 'register';
    if (register && !String(values.get('name') ?? '').trim()) { formError('#auth-error', 'お名前を入力してください。'); return; }
    authBusy = true; const button = $<HTMLButtonElement>('#auth-submit'); button.disabled = true;
    $<HTMLButtonElement>('[data-action="switch-auth"]').disabled = true;
    formError('#auth-error'); button.textContent = register ? 'アカウントを作成中…' : 'ログイン中…';
    try {
        if (register) {
            await api('/api/auth/register', 'POST', { name: String(values.get('name')), email, password });
            setAuthMode('login');
        }
        const data = await api<LoginResponse>('/api/auth/login', 'POST', { email, password });
        session = { user: data.user, token: data.accessToken };
        clearTimeout(expiryTimer); expiryTimer = setTimeout(expireSession, data.expiresIn * 1000);
        authForm.reset(); authDialog.close(); updateHeader(); toast(register ? '登録しました。最初の記録を残してみましょう。' : 'ログインしました。おかえりなさい。');
        const intention = afterAuth; afterAuth = null;
        navigate('#/studio');
        if (intention === 'write') showEditor();
    } catch (error) {
        formError('#auth-error', message(error));
    } finally {
        authBusy = false; button.disabled = false; $<HTMLButtonElement>('[data-action="switch-auth"]').disabled = false;
        button.textContent = authMode === 'register' ? 'アカウントを作成する' : 'ログイン';
    }
});
editorForm.addEventListener('submit', async event => {
    event.preventDefault(); if (editorBusy) return;
    if (!session) { formError('#editor-error', 'ログインの有効期限が切れています。本文を控えてから再ログインしてください。'); return; }
    const form = new FormData(editorForm); const title = String(form.get('title') ?? '').trim(); const content = String(form.get('content') ?? '').trim();
    if (!title || !content) { formError('#editor-error', 'タイトルと本文を入力してください。'); return; }
    editorBusy = true; const button = $<HTMLButtonElement>('#editor-submit'); button.disabled = true; button.textContent = '保存中…'; formError('#editor-error');
    try {
        const published = form.has('published'); let post: Post;
        if (editing) post = await api<Post>(`/api/posts/${editing.id}`, 'PATCH', { title, content, published }, true);
        else {
            post = await api<Post>('/api/posts', 'POST', { title, content }, true);
            // Retain the saved draft ID if publishing fails; retry must update, not create a duplicate.
            editing = post;
            if (published) post = await api<Post>(`/api/posts/${post.id}`, 'PATCH', { published: true }, true);
        }
        editorDialog.close(); editorForm.reset(); editing = null;
        toast(post.published ? '記事を公開しました。' : '下書きを保存しました。'); navigate(`#/studio/${post.id}`);
    } catch (error) { formError('#editor-error', message(error)); }
    finally { editorBusy = false; button.disabled = false; button.textContent = '保存する'; }
});
editorForm.addEventListener('input', () => { $('#character-count').textContent = `${(editorForm.elements.namedItem('content') as HTMLTextAreaElement).value.length}文字`; });
async function confirmDelete(): Promise<void> {
    if (!deleting || deleteBusy) return;
    deleteBusy = true; const button = $<HTMLButtonElement>('#delete-submit'); button.disabled = true; formError('#delete-error');
    try {
        await api(`/api/posts/${deleting.id}`, 'DELETE', undefined, true);
        deleting = null; deleteDialog.close(); toast('記事を削除しました。'); navigate('#/studio');
    } catch (error) { formError('#delete-error', message(error)); }
    finally { deleteBusy = false; button.disabled = false; }
}
document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.skip-link')) { event.preventDefault(); main.focus(); return; }
    const target = event.target.closest<HTMLElement>('[data-action], [data-filter]'); if (!target) return;
    if (target.dataset.filter) {
        filter = target.dataset.filter as Filter;
        document.querySelectorAll<HTMLElement>('[data-filter]').forEach(tab => tab.setAttribute('aria-selected', String(tab === target)));
        renderList(location.hash === '#/studio'); return;
    }
    switch (target.dataset.action) {
        case 'login': showAuth('login'); break;
        case 'register': showAuth('register'); break;
        case 'studio-login': showAuth('login', 'studio'); break;
        case 'close-auth': if (!authBusy) { authDialog.close(); authForm.reset(); afterAuth = null; } break;
        case 'switch-auth': if (!authBusy) setAuthMode(authMode === 'login' ? 'register' : 'login'); break;
        case 'logout': resetSession(); navigate('#/'); toast('ログアウトしました。'); break;
        case 'write': showEditor(); break;
        case 'close-editor': closeEditor(); break;
        case 'edit': if (currentPost) showEditor(currentPost); break;
        case 'delete': if (currentPost) { deleting = currentPost; $('#delete-name').textContent = currentPost.title; formError('#delete-error'); deleteDialog.showModal(); } break;
        case 'confirm-delete': void confirmDelete(); break;
        case 'close-delete': if (!deleteBusy) { deleteDialog.close(); deleting = null; } break;
        case 'retry': void render(); break;
        case 'clear-search': query = ''; $<HTMLInputElement>('#search').value = ''; renderList(location.hash === '#/studio'); break;
    }
});
document.addEventListener('input', event => { if (event.target instanceof HTMLInputElement && event.target.id === 'search') { query = event.target.value; renderList(location.hash === '#/studio'); } });
editorDialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
authDialog.addEventListener('cancel', event => { if (authBusy) event.preventDefault(); else { authForm.reset(); afterAuth = null; } });
deleteDialog.addEventListener('cancel', event => { if (deleteBusy) event.preventDefault(); });
window.addEventListener('beforeunload', event => { if (editorDialog.open && editorSnapshot() !== editorBaseline) event.preventDefault(); });
window.addEventListener('hashchange', () => { void render(); window.scrollTo({ top: 0, behavior: 'instant' }); });
updateHeader(); void render();

document.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-filter]')];
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
});
