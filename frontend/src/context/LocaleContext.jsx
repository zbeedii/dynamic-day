import { createContext, useContext, useMemo, useState } from "react";

const LocaleContext = createContext(null);

const translations = {
  ar: {
    "Now": "الآن", "Plan": "التخطيط", "Focus": "التركيز", "Sign out": "تسجيل الخروج",
    "Settings": "الإعدادات", "Friction threshold": "حدّ الاحتكاك", "Reward chance": "احتمال المكافأة",
    "Browser reminders": "تذكيرات المتصفح", "In-app reminders always fire.": "تذكيرات داخل التطبيق تعمل دائمًا.",
    "Calm backdrop in focus": "خلفية هادئة أثناء التركيز", "A quiet ambient glow while you work.": "إضاءة هادئة أثناء العمل.",
    "Saving…": "جارٍ الحفظ…", "English": "English", "العربية": "العربية", "Language": "اللغة",
    "Welcome back": "مرحبًا بعودتك", "Create your space": "أنشئ مساحتك", "Sign in": "تسجيل الدخول",
    "Get started": "ابدأ الآن", "Email": "البريد الإلكتروني", "Password": "كلمة المرور",
    "Create account": "إنشاء حساب",
    "Your day is a shape": "يومك له شكل", "not a list": "وليس مجرد قائمة",
    "Blocks of time, protected transitions, and percentages that quietly rebalance the moment reality moves. When it truly can't fit, it stops and asks you.": "فترات زمنية، انتقالات محمية، ونِسب يعاد توزيعها بهدوء عندما تتغير الظروف. وعندما لا يمكن أن يتسع الجدول، يتوقف ويسألك.", "Already have an account? Sign in": "لديك حساب بالفعل؟ تسجيل الدخول",
    "No account yet? Create one": "لا يوجد حساب؟ أنشئ حسابًا",
    "A day that re-plans itself": "يوم يعيد ترتيب نفسه", "PLAN": "خطط", "NOW": "الآن", "FOCUS": "ركز",
    "Leave focus": "مغادرة التركيز", "Nothing running": "لا توجد مهمة قيد التنفيذ",
    "You are between blocks": "أنت بين فترتين", "No block is active": "لا توجد فترة نشطة",
    "Focus mode stays empty until a block is live. That is deliberate.": "يبقى وضع التركيز فارغًا حتى تبدأ فترة نشطة. هذا مقصود.",
    "Start": "ابدأ", "Pause": "إيقاف مؤقت", "Done": "تم", "Finished for today": "إنهاء المهمة لليوم",
    "remaining": "متبقٍ", "allotted": "مخصص", "Add a quick step": "أضف خطوة سريعة",
    "Protected minimum": "الحد الأدنى المحمي", "Keep the minimum": "الحفاظ على الحد الأدنى",
    "Accept": "قبول", "Drop it from today": "إسقاطها من اليوم", "Running over": "تجاوز الوقت",
    "Give it 15 more minutes": "امنحها 15 دقيقة إضافية", "Finish it now": "إنهاؤها الآن",
    "Keep going, stop asking": "الاستمرار دون سؤال", "Drop it": "إسقاطها",
    "Conscious friction": "احتكاك يحتاج قرارًا", "Automatic rebalancing has stopped. Nothing on your schedule will move until you choose.": "توقف التعديل التلقائي. لن يتحرك شيء في جدولك حتى تختار.",
    "Keep the minimum": "حافظ على الحد الأدنى", "Allow reduction": "السماح بالتقليل",
    "Pull forward": "سحب وقت من المستقبل", "All remaining": "كل المتبقي", "+15m": "+15 د", "+30m": "+30 د", "Cancel": "إلغاء", "Apply": "تطبيق"
  }
};

export function LocaleProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem("dd_language") || "en");
  const setLanguage = (next) => { const v = next === "ar" ? "ar" : "en"; localStorage.setItem("dd_language", v); setLanguageState(v); };
  const value = useMemo(() => ({ language, setLanguage, t: (key) => translations[language]?.[key] || key }), [language]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
