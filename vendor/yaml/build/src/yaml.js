// Exposes the yaml package as self.OrosYAML for Pad (no module loader in orOS).
import * as YAML from "yaml";
self.OrosYAML = YAML;
