use std::sync::LazyLock;

use regex::Regex;

static RF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<RF(?:\s+[^>]*)?>(.*?)<Rf>").unwrap());
static RX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<RX([^>]+)>").unwrap());
static TS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<TS(?:\d+)?>(.*?)<Ts>").unwrap());
static FI: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<FI>(.*?)<Fi>").unwrap());
static FR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<FR>(.*?)<Fr>").unwrap());
static FU: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<FU>(.*?)<Fu>").unwrap());
static WG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<WG(\d+)>").unwrap());
static WH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<WH(\d+)>").unwrap());
static WT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<WT([^>]+)>").unwrap());
static INDENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<P[IF](\d)>").unwrap());

/// Converts the General Bible Format tags used by MySword into HTML.
/// Unknown tags are left in place and removed later by the sanitizer.
pub fn gbf_to_html(input: &str) -> String {
    let mut output = RF.replace_all(input, r#"<span class="note">$1</span>"#).into_owned();
    output = RX
        .replace_all(&output, r##"<a class="xref" href="#b$1">$1</a>"##)
        .into_owned();
    output = TS
        .replace_all(&output, r#"<span class="heading">$1</span>"#)
        .into_owned();
    output = FI.replace_all(&output, "<i>$1</i>").into_owned();
    output = FR
        .replace_all(&output, r#"<span class="words-of-jesus">$1</span>"#)
        .into_owned();
    output = FU.replace_all(&output, "<u>$1</u>").into_owned();
    output = WG
        .replace_all(&output, r#"<span class="strong-greek">G$1</span>"#)
        .into_owned();
    output = WH
        .replace_all(&output, r#"<span class="strong-hebrew">H$1</span>"#)
        .into_owned();
    output = WT
        .replace_all(&output, r#"<span class="morph">$1</span>"#)
        .into_owned();
    output = INDENT
        .replace_all(&output, r#"<span class="indent-$1"></span>"#)
        .into_owned();
    output = output.replace("<CM>", "<br/>");
    output = output.replace("<Q>", "").replace("<q>", "");
    output = output.replace("<E>", "").replace("<e>", "");
    output = output.replace("<T>", "").replace("<t>", "");
    output
}

pub fn sanitize_html(input: &str) -> String {
    let mut builder = ammonia::Builder::default();
    builder
        .add_tags(["span", "div", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "td", "th"])
        .add_generic_attributes(["class"])
        .link_rel(Some("noopener noreferrer"));
    builder.clean(input).to_string()
}

pub fn normalize_html(input: &str, source_format: &str) -> String {
    let converted = if source_format == "mysword" {
        gbf_to_html(input)
    } else {
        input.to_string()
    };
    sanitize_html(&converted)
}


