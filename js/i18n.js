(function(){
  const STORAGE_KEY = 'factopolis_ui_options';
  const LANGS = ['fr', 'en', 'es'];
  const DEFAULT_LANG = 'fr';
  const TRANSLATIONS = window.FACTOPOLIS_TRANSLATIONS || {};

  function savedOptions(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
    catch(e){ return {}; }
  }

  function normalizeLang(lang){
    return LANGS.includes(lang) ? lang : DEFAULT_LANG;
  }

  function currentLang(){
    let fromUi = null;
    try {
      fromUi = (typeof UI_OPTIONS !== 'undefined') && UI_OPTIONS.language;
    } catch(e) {}
    return normalizeLang(fromUi || savedOptions().language || DEFAULT_LANG);
  }

  function dictionary(lang){
    return TRANSLATIONS[normalizeLang(lang)] || TRANSLATIONS[DEFAULT_LANG] || {};
  }

  function t(key, vars){
    const lang = currentLang();
    const value = dictionary(lang)[key] ?? dictionary(DEFAULT_LANG)[key] ?? key;
    if(!vars) return value;
    return String(value).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  }

  function applyI18n(root){
    root = root || document;
    const lang = currentLang();
    document.documentElement.lang = t('meta.lang');
    document.title = t('meta.title');
    root.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
    window.dispatchEvent(new CustomEvent('factopolis:languagechange', { detail:{ lang } }));
  }

  function persistLanguage(lang){
    const next = savedOptions();
    next.language = normalizeLang(lang);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function setLanguage(lang){
    lang = normalizeLang(lang);
    if(typeof UI_OPTIONS !== 'undefined'){
      UI_OPTIONS.language = lang;
      if(typeof saveUIOptions === 'function') saveUIOptions();
      else persistLanguage(lang);
    } else {
      persistLanguage(lang);
    }
    applyI18n();
  }

  window.I18N_LANGS = LANGS;
  window.t = t;
  window.applyI18n = applyI18n;
  window.setLanguage = setLanguage;
  window.currentLanguage = currentLang;
})();
