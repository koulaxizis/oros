import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { csharp, kotlin, dart } from "@codemirror/legacy-modes/mode/clike";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { r } from "@codemirror/legacy-modes/mode/r";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
var L = self.OrosCM.lang;
function s(m) { return function () { return StreamLanguage.define(m); }; }
L.shell = s(shell); L.toml = s(toml); L.lua = s(lua); L.ini = s(properties); L.diff = s(diff);
L.powershell = s(powerShell); L.dockerfile = s(dockerFile); L.ruby = s(ruby); L.perl = s(perl);
L.csharp = s(csharp); L.kotlin = s(kotlin); L.dart = s(dart); L.swift = s(swift); L.r = s(r); L.nginx = s(nginx);
