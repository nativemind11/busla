// ===================== دوال مساعدة عامة لموقع BUSLA =====================

// نداء GET للباك إند (قراءة بيانات)
// بيستخدم كاش محسّن في المتصفح (localStorage): لو فيه نسخة محفوظة من نفس الطلب بترجع فورًا
// عشان الصفحة تظهر بسرعة، وفي نفس الوقت بيتم تحديثها في الخلفية من غير ما اليوزر يستنى.
// كمان بيحط مهلة زمنية (timeout) عشان لو الباك إند اتعلق، الصفحة مش تفضل معلقة على "بيحمل..." للأبد.
//
// ملحوظة مهمة: Google Apps Script (اللي هو الباك إند بتاعنا) بطيء نسبيًا وبيعمل "cold start"
// كل شوية (بياخد كام ثانية لوحده قبل ما ينفذ أي حاجة)، وده غير وقت تنفيذ الكود نفسه.
// عشان كده لازم نديله مهلة كافية، خصوصًا في الطلبات اللي بتكتب بيانات أو بترفع صور
// (زي رفع إيصال الدفع)، لأنها بتاخد وقت أطول بكتير من مجرد قراءة بيانات.
const API_TIMEOUT_MS = 35000; // مهلة الطلبات العادية (قراءة GET) — زودناها شوية عشان لو Apps Script بطيء (cold start) الصفحة متفشلش من أول محاولة
const API_TIMEOUT_MS_WRITE = 30000; // مهلة الطلبات اللي بتكتب بيانات (POST) عمومًا
const API_TIMEOUT_MS_UPLOAD = 55000; // مهلة الطلبات اللي فيها رفع صورة (Drive + إيميل ممكن ياخدوا وقت أطول)
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 دقايق (بدل 5)

function withTimeout(promise, ms = API_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("الطلب استغرق وقت طويل، جرب تاني")), ms))
  ]);
}

async function apiGet(action, params = {}) {
  // مفتاح الكاش من الأكشن والبارامترز بس (من غير idToken)، عشان الكاش يفضل شغال صح
  const cacheKey = `bosla_cache_${new URLSearchParams({ action, ...params }).toString()}`;

  const fetchFresh = async () => {
    // لو فيه مستخدم مسجل دخول، بنرفق "تذكرة الدخول" بتاعته مع الطلب عشان الباك إند
    // يقدر يتأكد إن الطلب ده فعلاً منه (مطلوب للأكشنز الشخصية زي getMentee/getBookingsFor...)
    let idToken = null;
    try {
      if (auth.currentUser) idToken = await auth.currentUser.getIdToken();
    } catch (e) { /* لو فشل جيب التوكن، نكمل من غيره والباك إند هيرفض الأكشنز اللي محتاجاه */ }

    const query = new URLSearchParams({ action, ...params, ...(idToken ? { idToken } : {}) }).toString();
    const res = await withTimeout(fetch(`${SCRIPT_URL}?${query}`));
    const data = await res.json();
    try { localStorage.setItem(cacheKey, JSON.stringify({ data, time: Date.now() })); } catch (e) {}
    return data;
  };

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, time } = JSON.parse(cached);
      // النسخة المحفوظة صالحة للعرض الفوري لمدة 10 دقايق، وبيتم تحديثها بصمت في الخلفية
      if (Date.now() - time < CACHE_DURATION_MS) {
        fetchFresh().catch(() => {});
        return data;
      }
    }
  } catch (e) { /* لو حصل خطأ في قراءة الكاش، بنكمل عادي على الشبكة */ }

  return fetchFresh();
}

// بيمسح كاش القراءة بعد أي عملية كتابة (حجز، تسجيل، تأكيد...) عشان الصفحات تجيب بيانات محدثة فورًا
function clearApiCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith("bosla_cache_"))
      .forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// نداء POST للباك إند (كتابة بيانات) - بنستخدم text/plain عشان نتجنب مشاكل CORS مع Apps Script
// timeoutMs اختياري: مرره أعلى (API_TIMEOUT_MS_UPLOAD) للأكشنز اللي فيها رفع صورة
async function apiPost(action, payload = {}, timeoutMs = API_TIMEOUT_MS_WRITE) {
  // نفس فكرة apiGet: لو فيه مستخدم مسجل دخول، نرفق تذكرة الدخول بتاعته مع الطلب
  let idToken = null;
  try {
    if (auth.currentUser) idToken = await auth.currentUser.getIdToken();
  } catch (e) { /* لو فشل جيب التوكن، نكمل من غيره والباك إند هيرفض الأكشنز اللي محتاجاه */ }

  const res = await withTimeout(fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload, ...(idToken ? { idToken } : {}) })
  }), timeoutMs);
  const data = await res.json();
  clearApiCache(); // أي كتابة بيانات (حجز/تأكيد/تسجيل...) لازم تلغي الكاش عشان القراءة اللي بعدها تكون محدثة
  return data;
}

// تحويل ملف صورة لـ Base64 (لرفع إثبات الدفع)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// بتضغط أي صورة (سكرين شوت إيصال أو صورة بروفايل) قبل ما نبعتها للباك إند:
// بتصغّر أبعادها لحد أقصى وبتقلل جودة الـ JPEG شوية. الهدف: تقليل حجم الملف
// اللي بيترفع، عشان الرفع يبقى أسرع وعشان Google Apps Script (اللي بطيء أصلاً)
// ميستغرقش وقت طويل وهو بيعالج الصورة ويبعتها بالإيميل، وده كان بيسبب "طلب استغرق وقت طويل".
// بترجع نفس الـ file الأصلي لو حصل أي خطأ أثناء الضغط (fallback آمن).
function compressImageFile(file, maxDimension = 1600, quality = 0.72) {
  return new Promise((resolve) => {
    try {
      if (!file || !file.type || file.type.indexOf("image/") !== 0) { resolve(file); return; }
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) { height = Math.round(height * (maxDimension / width)); width = maxDimension; }
            else { width = Math.round(width * (maxDimension / height)); height = maxDimension; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) { resolve(file); return; }
            // لو الضغط لسبب ما زوّد الحجم بدل ما يقلله، استخدم الملف الأصلي
            if (blob.size >= file.size) { resolve(file); return; }
            resolve(new File([blob], file.name || "image.jpg", { type: "image/jpeg" }));
          }, "image/jpeg", quality);
        } catch (e) {
          URL.revokeObjectURL(objectUrl);
          resolve(file);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
      img.src = objectUrl;
    } catch (e) {
      resolve(file);
    }
  });
}

// تنظيف نص قبل حقنه في HTML (حماية بسيطة)
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// بناء دائرة صورة البروفايل (بترجع صورة حقيقية لو موجودة، وإلا أول حرف من الاسم)
function avatarHtml(name, photoUrl, sizeClass = "") {
  const initial = escapeHtml((name || "?").trim().charAt(0) || "?");
  const cls = "mentor-avatar" + (sizeClass ? " " + sizeClass : "");
  if (photoUrl) {
    return `<div class="${cls}"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name || "")}" loading="lazy"></div>`;
  }
  return `<div class="${cls}">${initial}</div>`;
}

// نص جهة العمل/الدراسة + سنوات الخبرة كسطر واحد (بيتخطى أي حقل فاضي)
function employerExperienceLine(employer, years) {
  const parts = [];
  if (employer) parts.push(escapeHtml(employer));
  if (years !== undefined && years !== null && years !== "") parts.push(`${escapeHtml(String(years))} سنين خبرة`);
  return parts.join(" · ");
}

// تطبيع رابط لينكدإن (بتضيف https:// لو المرشد كتب الرابط من غيرها)
function normalizeLinkedinUrl(value) {
  if (!value) return "";
  let v = String(value).trim();
  if (!v) return "";
  if (!/^https?:\/\//i.test(v)) v = "https://" + v.replace(/^\/+/, "");
  return v;
}

// أيقونة رابط لينكدإن المرشد - بتظهر بس لو المرشد حاط رابط بروفايله عند التسجيل
function linkedinIconHtml(url) {
  if (!url) return "";
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="linkedin-link" title="بروفايل المرشد على لينكدإن" onclick="event.stopPropagation()">🔗 لينكدإن</a>`;
}

// بناء نص نجوم للتقييم (مثال: ★★★★☆)
function starsText(rating) {
  const r = Math.round(Number(rating) || 0);
  return "★".repeat(Math.max(0, Math.min(5, r))) + "☆".repeat(5 - Math.max(0, Math.min(5, r)));
}

// رسالة تنبيه بسيطة (Toast)
function showToast(msg, type = "success") {
  let toast = document.getElementById("bosla-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "bosla-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast toast-${type} show`;
  setTimeout(() => toast.classList.remove("show"), 3500);
}

// حماية صفحة: لازم يكون فيه مستخدم مسجل دخول
function requireAuth(callback) {
  auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.href = "login/";
    } else {
      callback(user);
    }
  });
}

// بانر تذكير بتأكيد الإيميل - بيظهر فوق أي صفحة فيها الهيدر المشترك، لو المستخدم
// مسجل دخول بس لسه ماأكدش إيميله. بيدي زرار "أعد الإرسال" لو الإيميل الأول راح Spam أو ضاع.
function renderVerifyEmailBanner(user) {
  const existing = document.getElementById("bosla-verify-banner");
  if (existing) existing.remove();
  if (!user) return;

  user.reload().then(() => {
    if (user.emailVerified) return;

    const banner = document.createElement("div");
    banner.id = "bosla-verify-banner";
    banner.style.cssText = "position:sticky;top:0;z-index:999;background:#fff7e6;border-bottom:1px solid #f0c36d;color:#7a5b00;padding:10px 16px;text-align:center;font-size:13.5px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap";
    banner.innerHTML = `
      <span>⚠️ لسه ماأكدتش إيميلك (${escapeHtml(user.email || "")}). افتح الإيميل ودوس على رابط التأكيد.</span>
      <button id="bosla-resend-verify-btn" style="background:#7a5b00;color:#fff;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12.5px">أعد إرسال رابط التأكيد</button>
    `;
    document.body.prepend(banner);

    document.getElementById("bosla-resend-verify-btn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "بيتبعت...";
      try {
        await user.sendEmailVerification();
        showToast("اتبعت رابط تأكيد جديد على إيميلك");
      } catch (err) {
        showToast("حصل خطأ، جرب تاني كمان شوية", "error");
      }
      btn.disabled = false;
      btn.textContent = "أعد إرسال رابط التأكيد";
    });
  }).catch(() => { /* لو فشل التحديث، منسيبش الصفحة تتعطل */ });
}

// تعبئة قائمة المجالات (select)
function populateFieldsSelect(selectEl) {
  selectEl.innerHTML = '<option value="">اختر المجال</option>';
  Object.keys(FIELDS).forEach(field => {
    const opt = document.createElement("option");
    opt.value = field;
    opt.textContent = field;
    selectEl.appendChild(opt);
  });
}

// تعبئة قائمة التخصصات (select) بناءً على المجال المختار
function populateSpecializationsSelect(fieldValue, selectEl) {
  selectEl.innerHTML = '<option value="">اختر التخصص</option>';
  if (fieldValue && FIELDS[fieldValue]) {
    FIELDS[fieldValue].forEach(spec => {
      const opt = document.createElement("option");
      opt.value = spec;
      opt.textContent = spec;
      selectEl.appendChild(opt);
    });
  }
}

// ===================== الوضع الليلي (Dark Mode) =====================
// المفتاح المخزن في localStorage: "bosla_theme" بقيمة "light" أو "dark"
// بيتطبق فورًا (قبل حقن الهيدر) عن طريق سكريبت صغير في <head> كل صفحة، عشان
// مايحصلش وميض (flash) للوضع الغلط قبل ما الصفحة تحمل. الدالة دي بس بتزامن
// الزرار نفسه مع الحالة الحالية وبتتعامل مع الضغط عليه.
function getStoredTheme() {
  try { return localStorage.getItem("bosla_theme"); } catch (e) { return null; }
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("bosla_theme", next); } catch (e) {}
}
// تأكيد إضافي (لو الصفحة مفيهاش سكريبت الـ head المانع للوميض لأي سبب)
applyTheme(getStoredTheme() || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

// ===================== الهيدر المشترك (Navigation) =====================
function renderHeader() {
  const header = document.getElementById("bosla-header");
  if (!header) return;
  header.innerHTML = `
    <div class="nav-wrap">
      <a href="./" class="logo"><img src="assets/logo-mark.svg" alt="" width="34" height="34">BUSLA</a>
      <nav class="nav-links" id="nav-links">
        <a href="mentors/">لاقي مرشد</a>
        <a href="./#how">إزاي بتشتغل</a>
        <a href="contact/">تواصل معنا</a>
      </nav>
      <div class="nav-right">
        <div class="nav-auth" id="nav-auth">
          <button type="button" class="theme-toggle-btn" id="theme-toggle-btn" title="بدّل الوضع الليلي/النهاري" aria-label="بدّل الوضع الليلي/النهاري">
            <span class="theme-icon-sun">☀️</span><span class="theme-icon-moon">🌙</span>
          </button>
          <a href="login/" class="btn btn-ghost">تسجيل الدخول</a>
          <a href="register-mentee/" class="btn btn-primary">ابدأ دلوقتي</a>
        </div>
      </div>
    </div>
  `;
  const themeBtn = document.getElementById("theme-toggle-btn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
  auth.onAuthStateChanged(user => {
    const navAuth = document.getElementById("nav-auth");
    if (user && navAuth) {
      // رابط لوحة الأدمن بيظهر بس لو الإيميل اللي داخل بيه موجود في ADMIN_EMAILS (js/firebase-config.js)
      const isAdmin = typeof ADMIN_EMAILS !== "undefined" && ADMIN_EMAILS.includes(user.email);
      const adminLinkHtml = isAdmin ? `<a href="admin/" class="btn btn-ghost">لوحة الأدمن</a>` : "";

      navAuth.innerHTML = `
        <button type="button" class="theme-toggle-btn" id="theme-toggle-btn" title="بدّل الوضع الليلي/النهاري" aria-label="بدّل الوضع الليلي/النهاري">
          <span class="theme-icon-sun">☀️</span><span class="theme-icon-moon">🌙</span>
        </button>
        <a href="dashboard/" class="btn btn-ghost">لوحتي</a>
        ${adminLinkHtml}
        <button class="btn btn-primary" id="logout-btn">تسجيل خروج</button>
      `;
      document.getElementById("theme-toggle-btn").addEventListener("click", toggleTheme);
      document.getElementById("logout-btn").addEventListener("click", () => {
        auth.signOut().then(() => window.location.href = "./");
      });
    }
    // بانر تأكيد الإيميل متوقف مؤقتًا (هيتفعل تاني بعد ربط دومين مخصص بفايربيز)
    // renderVerifyEmailBanner(user);
  });
}

document.addEventListener("DOMContentLoaded", renderHeader);

// ===================== بوت الأسئلة الشائعة (Chatbot) =====================
// أسئلة جاهزة بضغطة زرار — من غير أي API خارجي أو تكلفة. آخر خيار بيفتح فورم تواصل بسيط.
// فيه مجموعتين: أسئلة للمستفيد (Mentee) وأسئلة للمرشد (Mentor)، وبيتم اختيار المجموعة المناسبة
// حسب الصفحة أو حسب دور المستخدم (window.__boslaRole) اللي بتحدده صفحات الداشبورد والشات.

const MENTEE_FAQ = [
  {
    q: "كيف تتم عملية الدفع؟",
    a: "يتم تحويل قيمة الجلسة إلى رقم إنستاباي الرسمي الخاص بمنصة BUSLA (وليس لحساب المرشد مباشرة)، ثم رفع صورة إيصال التحويل على المنصة. بعد مراجعة فريق BUSLA للإيصال وتأكيده، يظهر رابط الاجتماع في لوحة حسابك."
  },
  {
    q: "إلى أين تذهب الأموال، ومتى يستلمها المرشد؟",
    a: "المبلغ بيتحول أول حاجة لحساب BUSLA، مش لحساب المرشد مباشرة. وبعد انتهاء الجلسة وتأكيدها من الطرفين (المستفيد والمرشد)، تقوم BUSLA بتحويل نصيب المرشد على رقم الإنستاباي المسجل في حسابه، بعد خصم عمولة المنصة (10%)."
  },
  {
    q: "ماذا لو لم يحضر المرشد أو لم يُرسل رابط الاجتماع؟",
    a: "يمكنك التبليغ فورًا من خلال زر \"لسه عندي مشكلة\" في هذه الصفحة. سيراجع فريق BUSLA الحالة يدويًا، وفي حال ثبوت عدم انعقاد الجلسة يتم استرداد المبلغ المدفوع."
  },
  {
    q: "أين يتم حفظ بياناتي وصورة إيصال الدفع؟",
    a: "تُحفظ بياناتك وصورة الإيصال في مساحة تخزين خاصة بمنصة BUSLA، ولا تتم مشاركتها مع أي طرف سوى المرشد الذي حجزت معه، وذلك بغرض تأكيد الدفع فقط."
  },
  {
    q: "هل لديك استفسار آخر؟",
    a: null // ده اللي بيفتح فورم التواصل
  }
];

const MENTOR_FAQ = [
  {
    q: "كيف أستلم مستحقاتي المالية؟",
    a: "يقوم المستفيد بتحويل قيمة الجلسة إلى رقم إنستاباي BUSLA الرسمي (مش لحسابك مباشرة)، ويرفع صورة إيصال التحويل. يراجع فريق BUSLA الإيصال ويؤكده، وبعد انتهاء الجلسة وتأكيدها من الطرفين، تحول BUSLA نصيبك على رقم الإنستاباي المسجل في حسابك، بعد خصم عمولة المنصة (10%)."
  },
  {
    q: "هل هناك عمولة على المنصة؟",
    a: "نعم، تخصم BUSLA عمولة 10% من قيمة كل جلسة مدفوعة مقابل استخدام المنصة وخدمات المتابعة والدعم الفني."
  },
  {
    q: "كيف يظهر رابط الاجتماع للمستفيد؟",
    a: "تقوم بإضافة رابط الاجتماع الخاص بك من لوحة حسابك، وسيظهر تلقائيًا للمستفيد فور تأكيد الحجز."
  },
  {
    q: "ماذا لو لم يحضر المستفيد إلى الجلسة؟",
    a: "يمكنك الإبلاغ عن ذلك من لوحة حسابك، وسيقوم فريق BUSLA بمراجعة الحالة والتواصل مع المستفيد لمعرفة السبب."
  },
  {
    q: "هل لديك استفسار آخر؟",
    a: null // ده اللي بيفتح فورم التواصل
  }
];

// بيحدد مجموعة الأسئلة المناسبة: أولوية للدور المحدد صراحة (window.__boslaRole)،
// وإلا بيعتمد على مسار الصفحة (صفحة تسجيل المرشد = أسئلة مرشد)، وإلا الافتراضي أسئلة المستفيد.
function getActiveFaq() {
  const role = window.__boslaRole || "";
  if (role === "mentor") return MENTOR_FAQ;
  if (role === "mentee") return MENTEE_FAQ;
  if (window.location.pathname.includes("register-mentor")) return MENTOR_FAQ;
  return MENTEE_FAQ;
}

function renderChatbot() {
  if (document.getElementById("bosla-chatbot-fab")) return;

  const fab = document.createElement("button");
  fab.id = "bosla-chatbot-fab";
  fab.className = "chatbot-fab";
  fab.setAttribute("aria-label", "أسئلة شائعة ومساعدة");
  fab.innerHTML = `<i class="fa-solid fa-comment-dots"></i>`;
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.id = "bosla-chatbot-panel";
  panel.className = "chatbot-panel";
  panel.innerHTML = `
    <div class="chatbot-header">
      <span>مساعدة BUSLA</span>
      <button class="chatbot-close" aria-label="قفل">&times;</button>
    </div>
    <div class="chatbot-body" id="chatbot-body"></div>
  `;
  document.body.appendChild(panel);

  function renderMenu() {
    const body = panel.querySelector("#chatbot-body");
    body.innerHTML = `<p class="chatbot-intro">اختر سؤالك:</p>`;
    getActiveFaq().forEach((item, i) => {
      const btn = document.createElement("button");
      btn.className = "chatbot-option-btn";
      btn.textContent = item.q;
      btn.addEventListener("click", () => {
        if (item.a) {
          renderAnswer(item.q, item.a);
        } else {
          renderContactForm();
        }
      });
      body.appendChild(btn);
    });
  }

  function renderAnswer(q, a) {
    const body = panel.querySelector("#chatbot-body");
    body.innerHTML = `
      <div class="chatbot-answer">
        <strong>${q}</strong>
        <p>${a}</p>
      </div>
      <button class="chatbot-option-btn chatbot-back-btn">⟵ رجوع للأسئلة</button>
    `;
    body.querySelector(".chatbot-back-btn").addEventListener("click", renderMenu);
  }

  function renderContactForm() {
    const body = panel.querySelector("#chatbot-body");
    body.innerHTML = `
      <form id="chatbot-contact-form" class="chatbot-contact-form">
        <p class="chatbot-intro">اكتب مشكلتك وهنرد عليك في أقرب وقت:</p>
        <input type="text" id="cc-name" placeholder="الاسم" required>
        <input type="text" id="cc-contact" placeholder="رقم موبايل أو إيميل للرد عليك" required>
        <textarea id="cc-message" rows="3" placeholder="اكتب مشكلتك هنا" required></textarea>
        <button type="submit" class="btn btn-primary btn-block">إرسال</button>
        <button type="button" class="chatbot-option-btn chatbot-back-btn">⟵ رجوع للأسئلة</button>
      </form>
    `;
    body.querySelector(".chatbot-back-btn").addEventListener("click", renderMenu);
    body.querySelector("#chatbot-contact-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      submitBtn.textContent = "بيتبعت...";
      const payload = {
        name: document.getElementById("cc-name").value.trim(),
        contact: document.getElementById("cc-contact").value.trim(),
        message: document.getElementById("cc-message").value.trim(),
        page: window.location.href
      };
      try {
        const res = await apiPost("submitContactMessage", payload);
        if (res && res.error) {
          showToast(res.error, "error");
          submitBtn.disabled = false;
          submitBtn.textContent = "إرسال";
          return;
        }
        body.innerHTML = `<div class="chatbot-answer"><p>تم استلام رسالتك، هنتواصل معاك في أقرب وقت 🙏</p></div>`;
      } catch (err) {
        showToast("حصل خطأ، جرب تاني", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "إرسال";
      }
    });
  }

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) renderMenu();
  });
  panel.querySelector(".chatbot-close").addEventListener("click", () => {
    panel.classList.remove("open");
  });
}

document.addEventListener("DOMContentLoaded", renderChatbot);
