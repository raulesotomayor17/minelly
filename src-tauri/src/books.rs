use crate::model::BookInfo;

/// The 66 books in the order used by e-Sword, MySword and most Bible software.
pub const BOOKS: [(&str, &str); 66] = [
    ("Génesis", "Gn"),
    ("Éxodo", "Ex"),
    ("Levítico", "Lv"),
    ("Números", "Nm"),
    ("Deuteronomio", "Dt"),
    ("Josué", "Jos"),
    ("Jueces", "Jc"),
    ("Rut", "Rt"),
    ("1 Samuel", "1S"),
    ("2 Samuel", "2S"),
    ("1 Reyes", "1R"),
    ("2 Reyes", "2R"),
    ("1 Crónicas", "1Cr"),
    ("2 Crónicas", "2Cr"),
    ("Esdras", "Esd"),
    ("Nehemías", "Neh"),
    ("Ester", "Est"),
    ("Job", "Job"),
    ("Salmos", "Sal"),
    ("Proverbios", "Pr"),
    ("Eclesiastés", "Ec"),
    ("Cantares", "Cnt"),
    ("Isaías", "Is"),
    ("Jeremías", "Jer"),
    ("Lamentaciones", "Lm"),
    ("Ezequiel", "Ez"),
    ("Daniel", "Dn"),
    ("Oseas", "Os"),
    ("Joel", "Jl"),
    ("Amós", "Am"),
    ("Abdías", "Abd"),
    ("Jonás", "Jon"),
    ("Miqueas", "Mi"),
    ("Nahúm", "Nah"),
    ("Habacuc", "Hab"),
    ("Sofonías", "Sof"),
    ("Hageo", "Hag"),
    ("Zacarías", "Zac"),
    ("Malaquías", "Mal"),
    ("Mateo", "Mt"),
    ("Marcos", "Mc"),
    ("Lucas", "Lc"),
    ("Juan", "Jn"),
    ("Hechos", "Hch"),
    ("Romanos", "Ro"),
    ("1 Corintios", "1Co"),
    ("2 Corintios", "2Co"),
    ("Gálatas", "Gá"),
    ("Efesios", "Ef"),
    ("Filipenses", "Fil"),
    ("Colosenses", "Col"),
    ("1 Tesalonicenses", "1Ts"),
    ("2 Tesalonicenses", "2Ts"),
    ("1 Timoteo", "1Ti"),
    ("2 Timoteo", "2Ti"),
    ("Tito", "Tit"),
    ("Filemón", "Flm"),
    ("Hebreos", "He"),
    ("Santiago", "Stg"),
    ("1 Pedro", "1P"),
    ("2 Pedro", "2P"),
    ("1 Juan", "1Jn"),
    ("2 Juan", "2Jn"),
    ("3 Juan", "3Jn"),
    ("Judas", "Jud"),
    ("Apocalipsis", "Ap"),
];

pub fn book_info(number: i64) -> BookInfo {
    let index = (number - 1).clamp(0, 65) as usize;
    let (name, abbreviation) = BOOKS[index];
    BookInfo {
        number,
        name: name.to_string(),
        abbreviation: abbreviation.to_string(),
    }
}

pub fn book_name(number: i64) -> String {
    book_info(number).name
}

pub fn all_books() -> Vec<BookInfo> {
    (1..=66).map(book_info).collect()
}

/// OSIS identifiers in the same order as `BOOKS`.
pub const OSIS_CODES: [&str; 66] = [
    "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "1Sam", "2Sam",
    "1Kgs", "2Kgs", "1Chr", "2Chr", "Ezra", "Neh", "Esth", "Job", "Ps", "Prov",
    "Eccl", "Song", "Isa", "Jer", "Lam", "Ezek", "Dan", "Hos", "Joel", "Amos",
    "Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal", "Matt",
    "Mark", "Luke", "John", "Acts", "Rom", "1Cor", "2Cor", "Gal", "Eph", "Phil",
    "Col", "1Thess", "2Thess", "1Tim", "2Tim", "Titus", "Phlm", "Heb", "Jas",
    "1Pet", "2Pet", "1John", "2John", "3John", "Jude", "Rev",
];

pub fn osis_code(number: i64) -> &'static str {
    let index = (number - 1).clamp(0, 65) as usize;
    OSIS_CODES[index]
}

pub fn book_number_from_osis(code: &str) -> Option<i64> {
    OSIS_CODES
        .iter()
        .position(|candidate| candidate.eq_ignore_ascii_case(code))
        .map(|index| index as i64 + 1)
}
