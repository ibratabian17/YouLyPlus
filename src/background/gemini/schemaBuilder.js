// ==================================================================================================
// SCHEMA BUILDER
// ==================================================================================================

export class SchemaBuilder {
  static buildRomanizationSchema(hasAnyChunks) {
    const baseSchema = {
      type: "OBJECT",
      properties: {
        romanized_lyrics: {
          type: "ARRAY",
          description: "An array of romanized lyric line objects, matching the input array's order and length.",
          items: {
            type: "OBJECT",
            properties: {
              text: {
                type: "STRING",
                description: "The fully romanized text of the entire line."
              },
              original_line_index: {
                type: "INTEGER",
                description: "The original index of the line from the input, which must be preserved."
              }
            },
            required: ["text", "original_line_index"]
          }
        }
      },
      required: ["romanized_lyrics"]
    };

    if (hasAnyChunks) {
      baseSchema.properties.romanized_lyrics.items.properties.chunk = {
        type: "ARRAY",
        nullable: true,
        description: "ONLY include if the original line had chunks. Otherwise omit entirely.",
        items: {
          type: "OBJECT",
          properties: {
            text: {
              type: "STRING",
              description: "The text of a single romanized chunk. MUST NOT be empty."
            },
            chunkIndex: {
              type: "INTEGER",
              description: "The original index of the chunk, which must be preserved."
            }
          },
          required: ["text", "chunkIndex"]
        }
      };
    }

    return baseSchema;
  }

  static buildSelectiveRomanizationSchema(hasAnyChunks) {
    const baseSchema = {
      type: "OBJECT",
      properties: {
        fixed_lines: {
          type: "ARRAY",
          description: "An array of corrected romanized lyric line objects for only the problematic lines.",
          items: {
            type: "OBJECT",
            properties: {
              text: {
                type: "STRING",
                description: "The fully romanized text of the entire line."
              },
              original_line_index: {
                type: "INTEGER",
                description: "The original index of the line from the input, which must be preserved."
              }
            },
            required: ["text", "original_line_index"]
          }
        }
      },
      required: ["fixed_lines"]
    };

    if (hasAnyChunks) {
      baseSchema.properties.fixed_lines.items.properties.chunk = {
        type: "ARRAY",
        nullable: true,
        description: "ONLY include if the original line had chunks. Otherwise omit entirely.",
        items: {
          type: "OBJECT",
          properties: {
            text: {
              type: "STRING",
              description: "The text of a single romanized chunk. MUST NOT be empty."
            },
            chunkIndex: {
              type: "INTEGER",
              description: "The original index of the chunk, which must be preserved."
            }
          },
          required: ["text", "chunkIndex"]
        }
      };
    }

    return baseSchema;
  }
}
