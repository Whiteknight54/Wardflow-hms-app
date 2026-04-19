// =============================================================================
// data.js
// =============================================================================
// PURPOSE: Centralized runtime config, translations, and persistent app state
// 
// This module initializes and maintains:
// - Default patient and doctor records (seed data)
// - Global arrays synced to localStorage (patients, doctors, teams, wards)
// - Permission templates, audit logs, and language metadata
// - System configuration (permissions, roster data, API base URL)
//
// LOAD ORDER: This file MUST load FIRST before auth.js and script.js
// The login page also loads this file so the auth module can resolve the API.
// =============================================================================


function resolveApiBaseUrl() {
  const explicit = String(window.WARDFLOW_API_BASE_URL || '').trim();
  if (explicit) return explicit;

  const devExplicit = String(window.WARDFLOW_DEV_API_BASE_URL || '').trim();
  if (devExplicit) return devExplicit;

  const stored = String(sessionStorage.getItem('wardflow_api_base_url') || localStorage.getItem('wardflow_api_base_url') || '').trim();
  if (stored) return stored;

  // Prefer same-origin /api for Nginx-first routing
  if (window.location.origin && window.location.origin.startsWith('http')) {
    return '/api';
  }

  // Fallback for localhost development (rare)
  const host = String(window.location.hostname || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://127.0.0.1:8001/api';
  }

  return '/api';
}

window.resolveApiBaseUrl = resolveApiBaseUrl;

const appTranslations = {
  en: {
    app_title: 'WardFlow: Admissions & Team Tracking',
    page_title_app: 'WardFlow: Admissions & Team Tracking',
    page_title_login: 'WardFlow - Secure Login',
    page_title_analytics: 'WardFlow: Analytics Dashboard',
    topbar_profile: 'My Profile',
    topbar_settings: 'Account Settings',
    topbar_support: 'Help & Support',
    topbar_logout: 'Log Out',
    topbar_search: 'Search',
    topbar_bed_matrix: 'Bed Matrix',
    topbar_admit: 'Admit Patient',
    profile_title: 'My Profile',
    profile_desc: 'View your administrative credentials and assignments.',
    settings_title: 'Account Settings',
    settings_desc: 'Manage your preferences and security.',
    settings_notifications: 'Notifications',
    settings_security: 'Security',
    settings_language_label: 'App language',
    settings_language_help: 'Choose the language used across the interface.',
    settings_save_language: 'Save Language',
    settings_change_password: 'Change Password',
    settings_2fa: 'Setup Two-Factor Auth (2FA)',
    support_title: 'Help & Support',
    support_desc: 'Get assistance with the WardFlow system.',
    support_it_helpdesk: 'IT Helpdesk',
    support_docs: 'Documentation',
    nav_admissions: 'Admissions/Ward flow',
    nav_census: 'Ward Census',
    nav_workload: 'Team Workload',
    nav_analytics: 'Analytics Dashboard',
    nav_system: 'System Management',
    stat_total_occupancy: 'Total Occupancy',
    stat_active_teams: 'Active Teams',
    stat_admissions_today: 'Admissions Today',
    stat_transfers_today: 'Transfers Today',
    stat_discharged_today: 'Discharged Today',
    analytics_pending_admissions: 'Pending admissions',
    bed_matrix_desc: 'View real-time bed status across all wards.',
    bed_matrix_select_ward: 'Select Ward',
    admit_ward_bed_label: 'Assign ward and preferred bed',
    admit_bed_hint: 'No bed selected. A bed will be auto-assigned after you pick a ward.',
    search_placeholder: 'Search patient...',
    admissions_title: 'Patient Census',
    admissions_desc: 'All admitted patients - transfer, view details, or log treatment',
    col_patient_name: 'Patient name',
    col_age: 'Age',
    col_sex: 'Sex',
    col_ward: 'Ward',
    col_bed: 'Bed',
    col_actions: 'Actions',
    col_log: 'Log',
    system_title: 'System Management',
    system_desc: 'Configure system settings and monitor operations',
    analytics_title: 'Operational Analytics',
    analytics_desc: 'Live capacity modeling and team workload distribution',
    analytics_group_flow: 'Patient Flow',
    analytics_group_capacity: 'Capacity and Resources',
    workload_title: 'Team Workload',
    workload_desc: 'Monitor patient assignments and team capacity',
    census_title: 'Ward Census',
    census_desc: 'Monitor patient assignments and team capacity',
    lang_english: 'English',
    lang_french: 'French',
    lang_spanish: 'Spanish',
    lang_chinese: 'Chinese',
    lang_arabic: 'Arabic'
  },
  fr: {
    app_title: 'WardFlow : Admissions et suivi des équipes',
    page_title_app: 'WardFlow : Admissions et suivi des équipes',
    page_title_login: 'WardFlow - Connexion sécurisée',
    page_title_analytics: 'WardFlow : Tableau de bord analytique',
    topbar_profile: 'Mon profil',
    topbar_settings: 'Paramètres du compte',
    topbar_support: 'Aide et assistance',
    topbar_logout: 'Déconnexion',
    topbar_search: 'Rechercher',
    topbar_bed_matrix: 'Matrice des lits',
    topbar_admit: 'Admettre un patient',
    profile_title: 'Mon profil',
    profile_desc: 'Consultez vos identifiants administratifs et vos affectations.',
    settings_title: 'Paramètres du compte',
    settings_desc: 'Gérez vos préférences et la sécurité.',
    settings_notifications: 'Notifications',
    settings_security: 'Sécurité',
    settings_language_label: 'Langue de l’application',
    settings_language_help: 'Choisissez la langue utilisée dans l’interface.',
    settings_save_language: 'Enregistrer la langue',
    settings_change_password: 'Modifier le mot de passe',
    settings_2fa: 'Configurer l’authentification à deux facteurs (2FA)',
    support_title: 'Aide et assistance',
    support_desc: 'Obtenez de l’aide pour le système WardFlow.',
    support_it_helpdesk: 'Service informatique',
    support_docs: 'Documentation',
    nav_admissions: 'Admissions/flux de service',
    nav_census: 'Recensement du service',
    nav_workload: 'Charge de travail de l’équipe',
    nav_analytics: 'Tableau de bord analytique',
    nav_system: 'Gestion du système',
    stat_total_occupancy: 'Occupation totale',
    stat_active_teams: 'Équipes actives',
    stat_admissions_today: 'Admissions du jour',
    stat_transfers_today: 'Transferts du jour',
    stat_discharged_today: 'Sorties du jour',
    analytics_pending_admissions: 'Admissions en attente',
    bed_matrix_desc: 'Consultez l’état des lits en temps réel dans tous les services.',
    bed_matrix_select_ward: 'Sélectionner le service',
    admit_ward_bed_label: 'Attribuer le service et le lit préféré',
    admit_bed_hint: 'Aucun lit sélectionné. Un lit sera attribué automatiquement après le choix du service.',
    search_placeholder: 'Rechercher un patient...',
    admissions_title: 'Recensement des patients',
    admissions_desc: 'Tous les patients hospitalisés - transfert, détails ou traitement',
    col_patient_name: 'Nom du patient',
    col_age: 'Âge',
    col_sex: 'Sexe',
    col_ward: 'Service',
    col_bed: 'Lit',
    col_actions: 'Actions',
    col_log: 'Journal',
    system_title: 'Gestion du système',
    system_desc: 'Configurez les paramètres du système et surveillez les opérations',
    analytics_title: 'Analyse opérationnelle',
    analytics_desc: 'Modélisation en direct de la capacité et de la charge de travail',
    analytics_group_flow: 'Flux des patients',
    analytics_group_capacity: 'Capacité et ressources',
    workload_title: 'Charge de travail de l’équipe',
    workload_desc: 'Suivez les affectations des patients et la capacité des équipes',
    census_title: 'Recensement du service',
    census_desc: 'Suivez les affectations des patients et la capacité des équipes',
    lang_english: 'Anglais',
    lang_french: 'Français',
    lang_spanish: 'Espagnol',
    lang_chinese: 'Chinois',
    lang_arabic: 'Arabe'
  },
  es: {
    app_title: 'WardFlow: Admisiones y seguimiento de equipos',
    page_title_app: 'WardFlow: Admisiones y seguimiento de equipos',
    page_title_login: 'WardFlow - Inicio de sesión seguro',
    page_title_analytics: 'WardFlow: Panel de análisis',
    topbar_profile: 'Mi perfil',
    topbar_settings: 'Configuración de la cuenta',
    topbar_support: 'Ayuda y soporte',
    topbar_logout: 'Cerrar sesión',
    topbar_search: 'Buscar',
    topbar_bed_matrix: 'Matriz de camas',
    topbar_admit: 'Admitir paciente',
    profile_title: 'Mi perfil',
    profile_desc: 'Consulta tus credenciales administrativas y asignaciones.',
    settings_title: 'Configuración de la cuenta',
    settings_desc: 'Gestiona tus preferencias y seguridad.',
    settings_notifications: 'Notificaciones',
    settings_security: 'Seguridad',
    settings_language_label: 'Idioma de la aplicación',
    settings_language_help: 'Elige el idioma usado en la interfaz.',
    settings_save_language: 'Guardar idioma',
    settings_change_password: 'Cambiar contraseña',
    settings_2fa: 'Configurar autenticación de dos factores (2FA)',
    support_title: 'Ayuda y soporte',
    support_desc: 'Obtén ayuda con el sistema WardFlow.',
    support_it_helpdesk: 'Mesa de ayuda TI',
    support_docs: 'Documentación',
    nav_admissions: 'Admisiones/flujo de sala',
    nav_census: 'Censo de sala',
    nav_workload: 'Carga de trabajo del equipo',
    nav_analytics: 'Panel de análisis',
    nav_system: 'Administración del sistema',
    stat_total_occupancy: 'Ocupación total',
    stat_active_teams: 'Equipos activos',
    stat_admissions_today: 'Admisiones de hoy',
    stat_transfers_today: 'Transferencias de hoy',
    stat_discharged_today: 'Altas de hoy',
    analytics_pending_admissions: 'Admisiones pendientes',
    bed_matrix_desc: 'Ver el estado de las camas en tiempo real en todas las salas.',
    bed_matrix_select_ward: 'Seleccionar sala',
    admit_ward_bed_label: 'Asignar sala y cama preferida',
    admit_bed_hint: 'No hay cama seleccionada. Se asignará una cama automáticamente después de elegir una sala.',
    search_placeholder: 'Buscar paciente...',
    admissions_title: 'Censo de pacientes',
    admissions_desc: 'Todos los pacientes ingresados - transferir, ver detalles o registrar tratamiento',
    col_patient_name: 'Nombre del paciente',
    col_age: 'Edad',
    col_sex: 'Sexo',
    col_ward: 'Sala',
    col_bed: 'Cama',
    col_actions: 'Acciones',
    col_log: 'Registro',
    system_title: 'Administración del sistema',
    system_desc: 'Configura los ajustes del sistema y supervisa las operaciones',
    analytics_title: 'Analítica operativa',
    analytics_desc: 'Modelado en vivo de capacidad y distribución de carga de trabajo',
    analytics_group_flow: 'Flujo de pacientes',
    analytics_group_capacity: 'Capacidad y recursos',
    workload_title: 'Carga de trabajo del equipo',
    workload_desc: 'Supervisa las asignaciones de pacientes y la capacidad del equipo',
    census_title: 'Censo de sala',
    census_desc: 'Supervisa las asignaciones de pacientes y la capacidad del equipo',
    lang_english: 'Inglés',
    lang_french: 'Francés',
    lang_spanish: 'Español',
    lang_chinese: 'Chino',
    lang_arabic: 'Árabe'
  },
  zh: {
    app_title: 'WardFlow：入院与团队跟踪',
    page_title_app: 'WardFlow：入院与团队跟踪',
    page_title_login: 'WardFlow - 安全登录',
    page_title_analytics: 'WardFlow：分析仪表盘',
    topbar_profile: '我的资料',
    topbar_settings: '账户设置',
    topbar_support: '帮助与支持',
    topbar_logout: '退出登录',
    topbar_search: '搜索',
    topbar_bed_matrix: '床位矩阵',
    topbar_admit: '收治患者',
    profile_title: '我的资料',
    profile_desc: '查看您的管理凭证和分配信息。',
    settings_title: '账户设置',
    settings_desc: '管理您的偏好和安全设置。',
    settings_notifications: '通知',
    settings_security: '安全',
    settings_language_label: '应用语言',
    settings_language_help: '选择界面中使用的语言。',
    settings_save_language: '保存语言',
    settings_change_password: '修改密码',
    settings_2fa: '设置双重验证（2FA）',
    support_title: '帮助与支持',
    support_desc: '获取 WardFlow 系统帮助。',
    support_it_helpdesk: 'IT 支持台',
    support_docs: '文档',
    nav_admissions: '入院/病区流程',
    nav_census: '病区统计',
    nav_workload: '团队工作量',
    nav_analytics: '分析仪表盘',
    nav_system: '系统管理',
    stat_total_occupancy: '总占用率',
    stat_active_teams: '活跃团队',
    stat_admissions_today: '今日入院',
    stat_transfers_today: '今日转床',
    stat_discharged_today: '今日出院',
    analytics_pending_admissions: '待入院',
    bed_matrix_desc: '查看所有病区的实时床位状态。',
    bed_matrix_select_ward: '选择病区',
    admit_ward_bed_label: '分配病区和首选床位',
    admit_bed_hint: '尚未选择床位。选择病区后将自动分配床位。',
    search_placeholder: '搜索患者...',
    admissions_title: '患者统计',
    admissions_desc: '所有已入院患者 - 转床、查看详情或记录治疗',
    col_patient_name: '患者姓名',
    col_age: '年龄',
    col_sex: '性别',
    col_ward: '病区',
    col_bed: '床位',
    col_actions: '操作',
    col_log: '记录',
    system_title: '系统管理',
    system_desc: '配置系统设置并监控运行',
    analytics_title: '运营分析',
    analytics_desc: '实时容量建模和团队工作量分布',
    analytics_group_flow: '患者流动',
    analytics_group_capacity: '容量与资源',
    workload_title: '团队工作量',
    workload_desc: '监控患者分配和团队容量',
    census_title: '病区统计',
    census_desc: '监控患者分配和团队容量',
    lang_english: '英语',
    lang_french: '法语',
    lang_spanish: '西班牙语',
    lang_chinese: '中文',
    lang_arabic: '阿拉伯语'
  },
  ar: {
    app_title: 'WardFlow: حالات الدخول وتتبع الفرق',
    page_title_app: 'WardFlow: حالات الدخول وتتبع الفرق',
    page_title_login: 'WardFlow - تسجيل دخول آمن',
    page_title_analytics: 'WardFlow: لوحة التحليلات',
    topbar_profile: 'ملفي',
    topbar_settings: 'إعدادات الحساب',
    topbar_support: 'المساعدة والدعم',
    topbar_logout: 'تسجيل الخروج',
    topbar_search: 'بحث',
    topbar_bed_matrix: 'مصفوفة الأسرة',
    topbar_admit: 'قبول مريض',
    profile_title: 'ملفي',
    profile_desc: 'عرض بيانات الاعتماد والتكليفات الإدارية الخاصة بك.',
    settings_title: 'إعدادات الحساب',
    settings_desc: 'إدارة التفضيلات والأمان.',
    settings_notifications: 'الإشعارات',
    settings_security: 'الأمان',
    settings_language_label: 'لغة التطبيق',
    settings_language_help: 'اختر اللغة المستخدمة في الواجهة.',
    settings_save_language: 'حفظ اللغة',
    settings_change_password: 'تغيير كلمة المرور',
    settings_2fa: 'إعداد المصادقة الثنائية (2FA)',
    support_title: 'المساعدة والدعم',
    support_desc: 'احصل على المساعدة في نظام WardFlow.',
    support_it_helpdesk: 'مكتب دعم تقنية المعلومات',
    support_docs: 'التوثيق',
    nav_admissions: 'القبول/تدفق الجناح',
    nav_census: 'إحصاء الجناح',
    nav_workload: 'عبء عمل الفريق',
    nav_analytics: 'لوحة التحليلات',
    nav_system: 'إدارة النظام',
    stat_total_occupancy: 'الإشغال الكلي',
    stat_active_teams: 'الفرق النشطة',
    stat_admissions_today: 'قبولات اليوم',
    stat_transfers_today: 'التحويلات اليوم',
    stat_discharged_today: 'الخروج اليوم',
    analytics_pending_admissions: 'القبولات المعلقة',
    bed_matrix_desc: 'عرض حالة الأسرة في الوقت الفعلي عبر جميع الأجنحة.',
    bed_matrix_select_ward: 'اختر الجناح',
    admit_ward_bed_label: 'تعيين الجناح والسرير المفضل',
    admit_bed_hint: 'لم يتم تحديد سرير. سيتم تعيين سرير تلقائيًا بعد اختيار الجناح.',
    search_placeholder: 'ابحث عن مريض...',
    admissions_title: 'إحصاء المرضى',
    admissions_desc: 'جميع المرضى المقبولين - التحويل أو عرض التفاصيل أو تسجيل العلاج',
    col_patient_name: 'اسم المريض',
    col_age: 'العمر',
    col_sex: 'الجنس',
    col_ward: 'الجناح',
    col_bed: 'السَرير',
    col_actions: 'الإجراءات',
    col_log: 'السجل',
    system_title: 'إدارة النظام',
    system_desc: 'تهيئة إعدادات النظام ومراقبة العمليات',
    analytics_title: 'التحليلات التشغيلية',
    analytics_desc: 'نمذجة السعة المباشرة وتوزيع عبء العمل',
    analytics_group_flow: 'تدفق المرضى',
    analytics_group_capacity: 'السعة والموارد',
    workload_title: 'عبء عمل الفريق',
    workload_desc: 'مراقبة تكليفات المرضى وسعة الفريق',
    census_title: 'إحصاء الجناح',
    census_desc: 'مراقبة تكليفات المرضى وسعة الفريق',
    lang_english: 'الإنجليزية',
    lang_french: 'الفرنسية',
    lang_spanish: 'الإسبانية',
    lang_chinese: 'الصينية',
    lang_arabic: 'العربية'
  }
};

const supportedLanguages = [
  { code: 'en', labelKey: 'lang_english', dir: 'ltr' },
  { code: 'fr', labelKey: 'lang_french', dir: 'ltr' },
  { code: 'es', labelKey: 'lang_spanish', dir: 'ltr' },
  { code: 'zh', labelKey: 'lang_chinese', dir: 'ltr' },
  { code: 'ar', labelKey: 'lang_arabic', dir: 'rtl' }
];

function getSavedLanguage() {
  const stored = String(localStorage.getItem('wardflow_language') || sessionStorage.getItem('wardflow_language') || '').trim();
  if (stored && appTranslations[stored]) return stored;

  const browserLang = String((navigator.language || navigator.userLanguage || 'en')).slice(0, 2).toLowerCase();
  if (appTranslations[browserLang]) return browserLang;

  return 'en';
}

function getCurrentLanguage() {
  return getSavedLanguage();
}

function t(key, fallback = '') {
  const lang = getCurrentLanguage();
  return appTranslations[lang]?.[key] || appTranslations.en[key] || fallback || key;
}

function setDocumentLanguage(lang) {
  const normalized = appTranslations[lang] ? lang : 'en';
  document.documentElement.lang = normalized;
  document.documentElement.dir = normalized === 'ar' ? 'rtl' : 'ltr';
}

function applyLanguagePreference(lang, options = {}) {
  const normalized = appTranslations[lang] ? lang : 'en';
  localStorage.setItem('wardflow_language', normalized);
  sessionStorage.setItem('wardflow_language', normalized);
  setDocumentLanguage(normalized);

  if (options.reload !== false) {
    window.location.reload();
  }
}

function getLanguageOptions() {
  return supportedLanguages.map(item => ({
    code: item.code,
    label: t(item.labelKey, item.code.toUpperCase()),
    dir: item.dir
  }));
}

window.appTranslations = appTranslations;
window.supportedLanguages = supportedLanguages;
window.getCurrentLanguage = getCurrentLanguage;
window.t = t;
window.applyLanguagePreference = applyLanguagePreference;
window.getLanguageOptions = getLanguageOptions;
setDocumentLanguage(getCurrentLanguage());

const defaultPatients = [
  {id:'027', name:'John Doe',age:54,sex:'M',ward:'General',bed:'Bed 3',team:'Alpha'},
  {id:'023', name:'Janet Doe',age:54,sex:'F',ward:'ICU',bed:'Bed 2',team:'Beta'},
  {id:'043', name:'James Doe',age:60,sex:'M',ward:'Cardiology',bed:'Bed 3',team:'Alpha'},
  {id:'012', name:'Susan Ray',age:69,sex:'F',ward:'ICU',bed:'Bed 4',team:'Gama'},
  {id:'008', name:'John Doe',age:64,sex:'M',ward:'Surgery',bed:'Bed 1',team:'Beta'},
  {id:'076', name:'John Done',age:12,sex:'M',ward:'Pediatric',bed:'Bed 3',team:'Delta'},
  {id:'037', name:'Elena Scott',age:31,sex:'F',ward:'Maternity',bed:'Bed 3',team:'Delta'},
  {id:'056', name:'Mark Desnon',age:51,sex:'M',ward:'Surgery',bed:'Bed 2',team:'Gama'},
  {id:'046', name:'Mark Desnon',age:64,sex:'M',ward:'ICU',bed:'Bed 6',team:'Alpha'},
  {id:'031', name:'Sarah Johnson',age:67,sex:'F',ward:'General',bed:'Bed 1',team:'Zulu'},
  {id:'032', name:'David Thompson',age:54,sex:'M',ward:'General',bed:'Bed 5',team:'Zulu'},
  {id:'033', name:'Lisa Brown',age:46,sex:'F',ward:'General',bed:'Bed 7',team:'Zulu'},
  {id:'034', name:'Emily Rodriguez',age:55,sex:'F',ward:'Cardiology',bed:'Bed 2',team:'Alpha'},
  {id:'035', name:'Amanda Lee',age:49,sex:'F',ward:'ICU',bed:'Bed 5',team:'Alpha'},
  {id:'036', name:'Michael Chen',age:42,sex:'M',ward:'Surgery',bed:'Bed 4',team:'Beta'},
  {id:'038', name:'Robert Martinez',age:61,sex:'M',ward:'Surgery',bed:'Bed 5',team:'Beta'},
  {id:'039', name:'Christopher Davis',age:70,sex:'M',ward:'Surgery',bed:'Bed 6',team:'Gama'},
  {id:'040', name:'James Anderson',age:58,sex:'M',ward:'Pediatric',bed:'Bed 2',team:'Delta'},
  {id:'041', name:'Lisa Johnson',age:54,sex:'F',ward:'ICU',bed:'Bed 8',team:'Gama'},
  {id:'042', name:'David Brown',age:37,sex:'M',ward:'ICU',bed:'Bed 9',team:'Gama'},
  {id:'101', name:'Sarah Jenkins', age:67, sex:'F', ward:'General', bed:'Bed 1', team:'Zulu'},
  {id:'102', name:'David Thompson', age:54, sex:'M', ward:'General', bed:'Bed 2', team:'Zulu'},
  {id:'103', name:'Lisa Brown', age:46, sex:'F', ward:'General', bed:'Bed 3', team:'Zulu'},
  {id:'104', name:'Mark Desnon', age:64, sex:'M', ward:'ICU', bed:'Bed 1', team:'Alpha'},
  {id:'105', name:'John Doe', age:54, sex:'M', ward:'Surgery', bed:'Bed 1', team:'Beta'},
  {id:'106', name:'Susan Ray', age:69, sex:'F', ward:'Cardiology', bed:'Bed 1', team:'Gama'},
  {id:'107', name:'Elena Scott', age:31, sex:'F', ward:'Maternity', bed:'Bed 1', team:'Delta'},
  {id:'108', name:'James Anderson', age:12, sex:'M', ward:'Pediatric', bed:'Bed 1', team:'Delta'},
  {id:'109', name:'Michael Chen', age:42, sex:'M', ward:'Surgery', bed:'Bed 2', team:'Beta'},
  {id:'110', name:'Amanda Lee', age:49, sex:'F', ward:'ICU', bed:'Bed 2', team:'Alpha'},
  {id:'111', name:'Robert Martinez', age:61, sex:'M', ward:'ICU', bed:'Bed 3', team:'Beta'},
  {id:'112', name:'Christopher Davis', age:70, sex:'M', ward:'General', bed:'Bed 4', team:'Gama'},
  {id:'113', name:'Lisa Johnson', age:54, sex:'F', ward:'Cardiology', bed:'Bed 2', team:'Alpha'},
  {id:'114', name:'David Brown', age:37, sex:'M', ward:'General', bed:'Bed 5', team:'Gama'},
  {id:'115', name:'Janet Doe', age:54, sex:'F', ward:'ICU', bed:'Bed 4', team:'Beta',},
  {id:'116', name:'Emily Rodriguez', age:55, sex:'F', ward:'Cardiology', bed:'Bed 3', team:'Alpha'},
  {id:'117', name:'John Done', age:12, sex:'M', ward:'Pediatric', bed:'Bed 2', team:'Delta'},
  {id:'118', name:'William Taylor', age:82, sex:'M', ward:'General', bed:'Bed 6', team:'Zulu'},
  {id:'119', name:'Jessica Moore', age:28, sex:'F', ward:'Maternity', bed:'Bed 2', team:'Delta'},
  {id:'120', name:'Thomas Jackson', age:45, sex:'M', ward:'Surgery', bed:'Bed 3', team:'Beta'},
  {id:'121', name:'Sarah White', age:33, sex:'F', ward:'General', bed:'Bed 7', team:'Zulu'},
  {id:'122', name:'Charles Harris', age:76, sex:'M', ward:'Cardiology', bed:'Bed 4', team:'Gama'},
  {id:'123', name:'Daniel Martin', age:50, sex:'M', ward:'ICU', bed:'Bed 5', team:'Alpha'},
  {id:'124', name:'Margaret Thompson', age:88, sex:'F', ward:'General', bed:'Bed 8', team:'Zulu'},
  {id:'125', name:'Joseph Garcia', age:62, sex:'M', ward:'Surgery', bed:'Bed 4', team:'Gama'},
  {id:'126', name:'Betty Martinez', age:71, sex:'F', ward:'Cardiology', bed:'Bed 5', team:'Alpha'},
  {id:'127', name:'Richard Robinson', age:39, sex:'M', ward:'General', bed:'Bed 9', team:'Zulu'},
  {id:'128', name:'Sandra Clark', age:58, sex:'F', ward:'ICU', bed:'Bed 6', team:'Beta'},
  {id:'129', name:'Paul Rodriguez', age:44, sex:'M', ward:'Surgery', bed:'Bed 5', team:'Beta'},
  {id:'130', name:'Donna Lewis', age:25, sex:'F', ward:'Maternity', bed:'Bed 3', team:'Delta'},
  {id:'131', name:'Kenneth Lee', age:9, sex:'M', ward:'Pediatric', bed:'Bed 3', team:'Delta'},
  {id:'132', name:'Carol Walker', age:65, sex:'F', ward:'General', bed:'Bed 10', team:'Zulu'},
  {id:'133', name:'Steven Hall', age:52, sex:'M', ward:'Cardiology', bed:'Bed 6', team:'Gama'},
  {id:'134', name:'Ruth Allen', age:79, sex:'F', ward:'General', bed:'Bed 11', team:'Zulu'},
  {id:'135', name:'Brian Young', age:47, sex:'M', ward:'ICU', bed:'Bed 7', team:'Alpha'}
];

const defaultDoctors = [
  { name: 'Dr. Gregory House', role: 'Consultant', grade: 'Lead Consultant', team: 'Team Alpha' },
  { name: 'Dr. Robert Chase', role: 'Junior Doctor', grade: 'ST5', team: 'Team Alpha' },
  { name: 'Dr. James Wilson', role: 'Consultant', grade: 'Lead Consultant', team: 'Team Beta' },
  { name: 'Dr. Eric Foreman', role: 'Junior Doctor', grade: 'ST4', team: 'Team Zulu' },
  { name: 'Dr. Lisa Cuddy', role: 'Consultant', grade: 'Lead Consultant', team: 'Team Delta' },
  { name: 'Dr. Allison Cameron', role: 'Junior Doctor', grade: 'FY2', team: 'Team Gama' }
];

// =============================================================================
// PERSISTENT APP STATE - Synced with localStorage
// =============================================================================
// All of these arrays are loaded from localStorage on app startup.
// If localStorage key doesn't exist, the defaultXxx fallback is used instead.
// Modified arrays are saved back to localStorage by script.js via saveData()

let patients = JSON.parse(localStorage.getItem('wardflow_patients')) || defaultPatients;
let doctors = JSON.parse(localStorage.getItem('wardflow_doctors')) || defaultDoctors;
let availableRoles = JSON.parse(localStorage.getItem('wardflow_roles')) || ['Consultant', 'Junior Doctor', 'Ward Manager', 'System Admin'];

let wardConfigs = JSON.parse(localStorage.getItem('wardflow_wards')) || [
  {name:'Cardiology', beds:20, status:'Active / Open'},
  {name:'ICU', beds:20, status:'Active / Open'},
  {name:'Maternity', beds:20, status:'Active / Open'},
  {name:'Pediatric', beds:20, status:'Active / Open'},
  {name:'Surgery', beds:20, status:'Active / Open'},
  {name:'General', beds:20, status:'Active / Open'}
];

let rosterData = JSON.parse(localStorage.getItem('wardflow_roster')) || {};
let sysPerms = JSON.parse(localStorage.getItem('wardflow_perms')) || { timeout: '30 Minutes', mfa: 'Mandatory for all users', ip: '10.0.0.*' };
let auditLog = JSON.parse(localStorage.getItem('wardflow_audit')) || [];

// =============================================================================
// TEAM CONFIGURATION - Static team structures (core business entities)
// =============================================================================
// These are the core teams in the system. Each team has:
// - count: number of patients currently assigned
// - wards: array of ward assignments with patient counts
// - patients: array of patient objects on this team
// Updated by syncData() in script.js after any patient data changes
// NOTE: Teams are persisted in localStorage so admins can add/remove teams safely

const defaultTeams = [
  {name:'Team Alpha', count:0, wards:[], patients:[]},
  {name:'Team Beta', count:0, wards:[], patients:[]},
  {name:'Team Delta', count:0, wards:[], patients:[]},
  {name:'Team Gama', count:0, wards:[], patients:[]},
  {name:'Team Zulu', count:0, wards:[], patients:[]},
];

let teams = JSON.parse(localStorage.getItem('wardflow_teams')) || defaultTeams;