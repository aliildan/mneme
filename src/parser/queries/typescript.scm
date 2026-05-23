; ── Functions ────────────────────────────────────────────────────────────────

(function_declaration
  name: (identifier) @name
  parameters: (formal_parameters) @params) @function

(generator_function_declaration
  name: (identifier) @name
  parameters: (formal_parameters) @params) @function

; ── Arrow / expression functions assigned to const ───────────────────────────

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @const_fn

(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (function_expression))) @const_fn

; ── Classes ───────────────────────────────────────────────────────────────────

(class_declaration
  name: (type_identifier) @name) @class

; ── Methods ───────────────────────────────────────────────────────────────────

(method_definition
  name: (property_identifier) @name) @method

; ── Interfaces ────────────────────────────────────────────────────────────────

(interface_declaration
  name: (type_identifier) @name) @interface

; ── Type aliases ──────────────────────────────────────────────────────────────

(type_alias_declaration
  name: (type_identifier) @name) @type_alias

; ── Enums ─────────────────────────────────────────────────────────────────────

(enum_declaration
  name: (identifier) @name) @enum

; ── Import statements (for edge extraction) ───────────────────────────────────

(import_statement
  source: (string (string_fragment) @source)) @import

; ── Export default ────────────────────────────────────────────────────────────

(export_statement
  "default"
  value: (_) @value) @default_export
