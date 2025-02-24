const translations = {
    'en-US': {
        loading: "Loading Lyrics...",
        notFound: "Unable To Find The Lyrics.",
        writtenBy: "Written By: ",
        source: "Source: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'id-ID': {
        loading: "Memuat Lirik...",
        notFound: "Tidak Dapat Menemukan Lirik.",
        writtenBy: "Ditulis Oleh: ",
        source: "Sumber: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'es-ES': {
        loading: "Cargando Letras...",
        notFound: "No Se Pudo Encontrar La Letra.",
        writtenBy: "Escrito Por: ",
        source: "Fuente: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'fr-FR': {
        loading: "Chargement des paroles...",
        notFound: "Impossible de trouver les paroles.",
        writtenBy: "Écrit par: ",
        source: "Source: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'de-DE': {
        loading: "Lade Liedtexte...",
        notFound: "Konnte die Liedtexte nicht finden.",
        writtenBy: "Geschrieben von: ",
        source: "Quelle: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'it-IT': {
        loading: "Caricamento dei testi...",
        notFound: "Impossibile trovare i testi.",
        writtenBy: "Scritto da: ",
        source: "Fonte: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'pt-PT': {
        loading: "Carregando Letras...",
        notFound: "Não Foi Possível Encontrar a Letra.",
        writtenBy: "Escrito por: ",
        source: "Fonte: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'nl-NL': {
        loading: "Songtekst Laden...",
        notFound: "Songtekst Niet Gevonden.",
        writtenBy: "Geschreven Door: ",
        source: "Bron: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'ru-RU': {
        loading: "Загрузка текста песни...",
        notFound: "Не удалось найти текст песни.",
        writtenBy: "Написано: ",
        source: "Источник: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'ja-JP': {
        loading: "歌詞を読み込んでいます...",
        notFound: "歌詞が見つかりませんでした。",
        writtenBy: "作詞: ",
        source: "ソース: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'zh-CN': {
        loading: "加载歌词...",
        notFound: "无法找到歌词。",
        writtenBy: "作者: ",
        source: "来源: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'ko-KR': {
        loading: "가사 불러오는 중...",
        notFound: "가사를 찾을 수 없습니다.",
        writtenBy: "작사: ",
        source: "출처: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'tr-TR': {
        loading: "Şarkı Sözleri Yükleniyor...",
        notFound: "Şarkı sözleri bulunamadı.",
        writtenBy: "Yazan: ",
        source: "Kaynak: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'pl-PL': {
        loading: "Ładowanie tekstu piosenki...",
        notFound: "Nie można znaleźć tekstu piosenki.",
        writtenBy: "Napisane przez: ",
        source: "Źródło: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'sv-SE': {
        loading: "Laddar låttexter...",
        notFound: "Kunde inte hitta låttexten.",
        writtenBy: "Skriven av: ",
        source: "Källa: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'ar-SA': {
        loading: "جارٍ تحميل كلمات الأغنية...",
        notFound: "تعذر العثور على كلمات الأغنية.",
        writtenBy: "كتبه: ",
        source: "المصدر: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    },
    'hi-IN': {
        loading: "गीत लोड हो रहा है...",
        notFound: "गीत के बोल नहीं मिले।",
        writtenBy: "लेखक: ",
        source: "स्रोत: ",
        notFoundError: "It Seems We Unable To Display The Lyrics"
    }
};


function getUserLanguage() {
    return document.documentElement.lang || 'en-US';
}

function t(key) {
    const lang = getUserLanguage();
    return translations[lang]?.[key] || translations['en-US'][key];
}
