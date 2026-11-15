use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceKind {
    Bible,
    Commentary,
    Dictionary,
    Reference,
    Map,
    Book,
}

impl ResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bible => "bible",
            Self::Commentary => "commentary",
            Self::Dictionary => "dictionary",
            Self::Reference => "reference",
            Self::Map => "map",
            Self::Book => "book",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Bible => "Biblia",
            Self::Commentary => "Comentario",
            Self::Dictionary => "Diccionario",
            Self::Reference => "Referencias",
            Self::Map => "Mapas",
            Self::Book => "Libro",
        }
    }

    pub fn from_db(value: &str) -> Self {
        match value {
            "commentary" => Self::Commentary,
            "dictionary" => Self::Dictionary,
            "reference" => Self::Reference,
            "map" => Self::Map,
            "book" => Self::Book,
            _ => Self::Bible,
        }
    }
}

impl std::fmt::Display for ResourceKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub kind: ResourceKind,
    pub title: String,
    pub abbreviation: String,
    pub language: String,
    pub source_format: String,
    pub source_path: String,
    pub verse_count: i64,
    pub entry_count: i64,
    pub imported_at: i64,
    pub metadata: serde_json::Value,
    #[serde(default)]
    pub search_priority: i64,
    #[serde(default)]
    pub cloud_synced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verse {
    pub book: i64,
    pub chapter: i64,
    pub verse: i64,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentaryEntry {
    pub book: i64,
    pub chapter_start: i64,
    pub verse_start: i64,
    pub chapter_end: i64,
    pub verse_end: i64,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryEntry {
    pub topic: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookInfo {
    pub number: i64,
    pub name: String,
    pub abbreviation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubChapterSummary {
    pub spine: i64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubChapter {
    pub spine: i64,
    pub title: String,
    pub href: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub kind: String,
    pub resource_id: String,
    pub resource_title: String,
    pub label: String,
    pub book: i64,
    pub chapter: i64,
    pub verse: i64,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub resource: Resource,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    pub resource: Resource,
    pub book: BookInfo,
    pub chapter: i64,
    pub verses: Vec<Verse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookText {
    pub resource: Resource,
    pub book: BookInfo,
    pub verses: Vec<Verse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbCustomAttribute {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbMetadata {
    pub title: String,
    pub resource_type: String,
    pub language: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub copyright: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cover_image_path: String,
    #[serde(default)]
    pub custom_attributes: Vec<PbbCustomAttribute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbSourceInput {
    pub path: String,
    pub order_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbSourceRecord {
    pub path: String,
    pub order_index: i64,
    pub modified: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbBook {
    pub resource_id: String,
    pub title: String,
    pub resource_type: String,
    pub language: String,
    pub author: String,
    pub copyright: String,
    pub description: String,
    pub cover_path: String,
    pub custom_attributes: Vec<PbbCustomAttribute>,
    pub sources: Vec<PbbSourceRecord>,
    pub log_path: String,
    pub status: String,
    pub error_count: i64,
    pub warning_count: i64,
    pub cloud_synced: bool,
    pub hidden: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbStage {
    pub id: i64,
    pub name: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbBuildRequest {
    pub metadata: PbbMetadata,
    pub sources: Vec<PbbSourceInput>,
    #[serde(default)]
    pub existing_resource_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PbbBuildResult {
    pub status: String,
    pub error_count: i64,
    pub warning_count: i64,
    pub log_path: String,
    pub resource_id: String,
    pub title: String,
    pub stages: Vec<PbbStage>,
    pub diagnostics: Vec<PbbDiagnostic>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub node_type: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub origin_uuid: Option<String>,
    #[serde(default)]
    pub shared_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub id: String,
    pub target_id: String,
    pub target_type: String,
    pub anchor_uri: String,
    pub exact_text: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    pub style_id: String,
    pub anchor_uri: String,
    pub exact_text: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub notebook_id: Option<String>,
    pub title: String,
    pub excerpt: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub origin_uuid: Option<String>,
    #[serde(default)]
    pub author_name: String,
    #[serde(default)]
    pub sort_order: i64,
    pub tags: Vec<Tag>,
    pub anchors: Vec<Anchor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub notebook_id: Option<String>,
    pub title: String,
    pub content_json: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub origin_uuid: Option<String>,
    #[serde(default)]
    pub author_name: String,
    #[serde(default)]
    pub sort_order: i64,
    pub tags: Vec<Tag>,
    pub anchors: Vec<Anchor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorInput {
    pub anchor_uri: String,
    pub exact_text: String,
    #[serde(default)]
    pub start_offset: i64,
    #[serde(default)]
    pub end_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    /// Identificador opcional: `note_upsert` lo usa para actualizar en lugar
    /// de crear. `note_create` y `note_update` lo ignoran.
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub notebook_id: Option<String>,
    pub title: String,
    pub content_json: serde_json::Value,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub anchors: Vec<AnchorInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFilter {
    pub notebook_id: Option<String>,
    pub tag_id: Option<String>,
    pub query: Option<String>,
    pub anchor_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationBundle {
    pub notes: Vec<NoteSummary>,
    pub highlights: Vec<Highlight>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesExportResult {
    pub path: String,
    pub notebooks: usize,
    pub notes: usize,
    pub anchors: usize,
    pub highlights: usize,
    pub tags: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesImportResult {
    pub notebooks: usize,
    pub notes: usize,
    pub anchors: usize,
    pub highlights: usize,
    pub tags: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsHealth {
    pub status: String,
    pub model: String,
    #[serde(alias = "model_loaded")]
    pub model_loaded: bool,
    #[serde(alias = "qwen_available")]
    pub qwen_available: bool,
    pub device: String,
    pub voices: usize,
    pub error: String,
    pub streaming: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    #[serde(alias = "voice_id")]
    pub voice_id: String,
    #[serde(alias = "display_name")]
    pub display_name: String,
    #[serde(alias = "reference_audio_path")]
    pub reference_audio_path: String,
    #[serde(alias = "reference_text")]
    pub reference_text: String,
    pub language: String,
    #[serde(alias = "is_custom_clone")]
    pub is_custom_clone: bool,
    pub speaker: String,
    pub description: String,
    #[serde(alias = "reference_audio_ready")]
    pub reference_audio_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsAudio {
    pub audio_base64: String,
    pub mime: String,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoiceList {
    pub voices: Vec<TtsVoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterlinearToken {
    pub word_order: i64,
    pub surface_text: String,
    pub original_manuscript: String,
    pub transliteration: String,
    pub lemma: String,
    pub strong_number: String,
    pub morphology_code: String,
    #[serde(default)]
    pub spanish_gloss: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterlinearVerse {
    pub verse: i64,
    pub tokens: Vec<InterlinearToken>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterlinearImportReport {
    pub tokens: usize,
    pub books: usize,
    pub verses: usize,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterlinearStatus {
    pub tokens: usize,
    pub books: usize,
    pub verses: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagContext {
    pub id: String,
    pub kind: String,
    pub resource_id: String,
    pub resource_title: String,
    pub label: String,
    pub text: String,
    pub book: i64,
    pub chapter: i64,
    pub verse: i64,
    pub spine: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagAnswer {
    pub answer: String,
    pub contexts: Vec<RagContext>,
    pub model: String,
    pub local_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteExportTagLink {
    pub note_id: String,
    pub tag_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UgcBundle {
    pub version: u32,
    pub exported_at: i64,
    pub notebooks: Vec<Notebook>,
    pub notes: Vec<Note>,
    pub anchors: Vec<Anchor>,
    pub highlights: Vec<Highlight>,
    pub tags: Vec<Tag>,
    pub note_tags: Vec<NoteExportTagLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sermon {
    pub id: String,
    pub title: String,
    pub series: String,
    pub series_number: Option<i64>,
    pub topics: Vec<String>,
    pub passages: Vec<String>,
    pub tags: Vec<String>,
    pub speaker: String,
    pub venue: String,
    pub service: String,
    pub date_time: String,
    pub audience: String,
    pub description: String,
    pub content_json: serde_json::Value,
    pub questions_json: serde_json::Value,
    pub slide_settings: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SermonInput {
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub series: String,
    #[serde(default)]
    pub series_number: Option<i64>,
    #[serde(default)]
    pub topics: Vec<String>,
    #[serde(default)]
    pub passages: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub speaker: String,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub date_time: String,
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "empty_document")]
    pub content_json: serde_json::Value,
    #[serde(default = "empty_array")]
    pub questions_json: serde_json::Value,
    #[serde(default = "empty_object")]
    pub slide_settings: serde_json::Value,
}

pub fn empty_document() -> serde_json::Value {
    serde_json::json!({
        "type": "doc",
        "content": [{ "type": "paragraph" }]
    })
}

pub fn empty_array() -> serde_json::Value {
    serde_json::json!([])
}

pub fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixabayImage {
    pub id: i64,
    pub preview_url: String,
    pub webformat_url: String,
    pub large_image_url: String,
    pub tags: String,
    pub user: String,
    pub page_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PixabaySearchResult {
    pub total: i64,
    pub total_hits: i64,
    pub images: Vec<PixabayImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexReport {
    pub resource_id: String,
    pub module_type: String,
    pub rows: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingIndexResource {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub indexed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalIndexStatus {
    pub total_resources: i64,
    pub indexed_resources: i64,
    pub pending_resources: i64,
    pub total_rows: i64,
    pub pending: Vec<PendingIndexResource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalSearchHit {
    pub resource_id: String,
    pub module_type: String,
    pub reference_key: String,
    pub fragment: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedSearchResult {
    pub source_type: String,
    pub resource_id: String,
    pub title: String,
    pub reference: String,
    pub snippet: String,
    pub book: Option<i64>,
    pub chapter: Option<i64>,
    pub verse: Option<i64>,
    pub spine: Option<i64>,
    pub note_id: Option<String>,
    #[serde(default)]
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBlock {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub level: i64,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideObjectExport {
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "type")]
    pub object_type: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub font_size: f64,
    #[serde(default)]
    pub font_family: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub align: String,
    #[serde(default)]
    pub radius: Option<f64>,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub z_index: i64,
    #[serde(default)]
    pub opacity: f64,
    #[serde(default)]
    pub shadow: bool,
    #[serde(default)]
    pub crop_top: f64,
    #[serde(default)]
    pub crop_right: f64,
    #[serde(default)]
    pub crop_bottom: f64,
    #[serde(default)]
    pub crop_left: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideExport {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: Vec<String>,
    #[serde(default)]
    pub reference: String,
    #[serde(default)]
    pub image_url: String,
    #[serde(default)]
    pub background: String,
    #[serde(default)]
    pub objects: Vec<SlideObjectExport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrongEntry {
    pub id: String,
    pub language: String,
    pub lemma: String,
    pub transliteration: String,
    pub pronunciation: String,
    pub definition: String,
    pub derivation: String,
    pub kjv: String,
    pub html: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordOccurrence {
    pub source: String,
    pub strong_number: String,
    pub book: i64,
    pub chapter: i64,
    pub verse: i64,
    pub word_order: i64,
    pub word: String,
    pub lemma: String,
    pub transliteration: String,
    pub morphology: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordStudyCount {
    pub source: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordStudyResult {
    pub entry: Option<StrongEntry>,
    pub counts: Vec<WordStudyCount>,
    pub occurrences: Vec<WordOccurrence>,
    pub lexicons: Vec<LexiconMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LexiconMatch {
    pub resource_id: String,
    pub resource_title: String,
    pub topic: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageRangeHit {
    pub id: i64,
    pub source_type: String,
    pub resource_id: String,
    pub sub_id: String,
    pub reference_display: String,
    pub snippet: String,
    pub start_verse_code: i64,
    pub end_verse_code: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub resource_id: String,
    pub spine: i64,
    pub paragraph_index: i64,
    pub scroll_ratio: f64,
    pub completed_spines: Vec<i64>,
    pub overall_percent: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookBookmark {
    pub id: String,
    pub resource_id: String,
    pub spine: i64,
    pub paragraph_index: i64,
    pub scroll_ratio: f64,
    pub label: String,
    pub note: String,
    pub excerpt: String,
    pub is_primary_ribbon: bool,
    pub bible_book: Option<i64>,
    pub bible_chapter: Option<i64>,
    pub bible_verse: Option<i64>,
    pub snippet: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
}
