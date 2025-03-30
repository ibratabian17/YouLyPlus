const translations = {
    'en-US': {
        loading: "Loading lyrics",
        notFound: "Unable to find the lyrics.",
        writtenBy: "Written by: ",
        source: "Source: ",
        notFoundError: "It seems we are unable to display the lyrics."
    },
    'id-ID': {
        loading: "Memuat lirik",
        notFound: "Tidak dapat menemukan lirik.",
        writtenBy: "Ditulis oleh: ",
        source: "Sumber: ",
        notFoundError: "Sepertinya kami tidak dapat menampilkan lirik."
    },
    'es-ES': {
        loading: "Cargando letras",
        notFound: "No se pudo encontrar la letra.",
        writtenBy: "Escrito por: ",
        source: "Fuente: ",
        notFoundError: "Parece que no podemos mostrar la letra."
    },
    'fr-FR': {
        loading: "Chargement des paroles",
        notFound: "Impossible de trouver les paroles.",
        writtenBy: "Écrit par: ",
        source: "Source: ",
        notFoundError: "Il semble que nous ne puissions pas afficher les paroles."
    },
    'de-DE': {
        loading: "Lade Liedtexte",
        notFound: "Konnte die Liedtexte nicht finden.",
        writtenBy: "Geschrieben von: ",
        source: "Quelle: ",
        notFoundError: "Es scheint, dass wir die Liedtexte nicht anzeigen können."
    },
    'it-IT': {
        loading: "Caricamento dei testi",
        notFound: "Impossibile trovare i testi.",
        writtenBy: "Scritto da: ",
        source: "Fonte: ",
        notFoundError: "Sembra che non possiamo mostrare i testi."
    },
    'pt-BR': {
        loading: "Carregando letras",
        notFound: "Não foi possível encontrar a letra.",
        writtenBy: "Escrito por: ",
        source: "Fonte: ",
        notFoundError: "Parece que não conseguimos exibir a letra."
    },
    'nl-NL': {
        loading: "Songtekst laden",
        notFound: "Songtekst niet gevonden.",
        writtenBy: "Geschreven door: ",
        source: "Bron: ",
        notFoundError: "Het lijkt erop dat we de songtekst niet kunnen weergeven."
    },
    'ru-RU': {
        loading: "Загрузка текста песни",
        notFound: "Не удалось найти текст песни.",
        writtenBy: "Написано: ",
        source: "Источник: ",
        notFoundError: "Похоже, мы не можем отобразить текст песни."
    },
    'ja-JP': {
        loading: "歌詞を読み込んでいます",
        notFound: "歌詞が見つかりませんでした。",
        writtenBy: "作詞: ",
        source: "ソース: ",
        notFoundError: "歌詞を表示できないようです。"
    },
    'zh-CN': {
        loading: "加载歌词",
        notFound: "无法找到歌词。",
        writtenBy: "作者: ",
        source: "来源: ",
        notFoundError: "看起来我们无法显示歌词。"
    },
    'ko-KR': {
        loading: "가사 불러오는 중",
        notFound: "가사를 찾을 수 없습니다.",
        writtenBy: "작사: ",
        source: "출처: ",
        notFoundError: "가사를 표시할 수 없는 것 같습니다."
    },
    'tr-TR': {
        loading: "Şarkı sözleri yükleniyor",
        notFound: "Şarkı sözleri bulunamadı.",
        writtenBy: "Yazan: ",
        source: "Kaynak: ",
        notFoundError: "Görünüşe göre şarkı sözlerini görüntüleyemiyoruz."
    },
    'pl-PL': {
        loading: "Ładowanie tekstu piosenki",
        notFound: "Nie można znaleźć tekstu piosenki.",
        writtenBy: "Napisane przez: ",
        source: "Źródło: ",
        notFoundError: "Wygląda na to, że nie możemy wyświetlić tekstu piosenki."
    },
    'sv-SE': {
        loading: "Laddar låttexter",
        notFound: "Kunde inte hitta låttexten.",
        writtenBy: "Skriven av: ",
        source: "Källa: ",
        notFoundError: "Det verkar som att vi inte kan visa låttexten."
    },
    'ar-SA': {
        loading: "جارٍ تحميل كلمات الأغنية",
        notFound: "تعذر العثور على كلمات الأغنية.",
        writtenBy: "كتبه: ",
        source: "المصدر: ",
        notFoundError: "يبدو أننا غير قادرين على عرض كلمات الأغنية."
    },
    'hi-IN': {
        loading: "गीत लोड हो रहा है",
        notFound: "गीत के बोल नहीं मिले।",
        writtenBy: "लेखक: ",
        source: "स्रोत: ",
        notFoundError: "ऐसा लगता है कि हम गीत के बोल प्रदर्शित नहीं कर सकते।"
    }
};



function getUserLanguage() {
    return document.documentElement.lang || 'en-US';
}

function t(key) {
    const lang = getUserLanguage();
    return translations[lang]?.[key] || translations['en-US'][key];
}
