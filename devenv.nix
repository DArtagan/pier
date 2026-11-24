{
  pkgs,
  ...
}:

{
  packages = [ pkgs.git ];

  languages = {
    nix.enable = true;
    # Node 26, as package.json's engines, and as p3 runs ("node 26+ all the way", its
    # decisions, 2026-11-18). The packages, pi's included, come from npm through
    # package-lock.json, whatever pi version nixpkgs ships (README, "Versions").
    javascript = {
      enable = true;
      package = pkgs.nodejs_26;
      npm = {
        enable = true;
        install.enable = true;
      };
    };
  };

  git-hooks.hooks = {
    actionlint.enable = true;
    biome.enable = true;
    check-added-large-files.enable = true;
    check-json.enable = true;
    check-merge-conflicts.enable = true;
    check-yaml.enable = true;
    # release-please derives every version and changelog entry from these.
    convco.enable = true;
    deadnix.enable = true;
    # CHANGELOG.md is written by release-please.
    end-of-file-fixer = {
      enable = true;
      excludes = [ "^CHANGELOG\\.md$" ];
    };
    nixfmt.enable = true;
    shellcheck.enable = true;
    shfmt.enable = true;
    statix.enable = true;
    trim-trailing-whitespace = {
      enable = true;
      excludes = [ "^CHANGELOG\\.md$" ];
    };
    typecheck = {
      enable = true;
      name = "typecheck";
      entry = "npm run check";
      files = "\\.ts$|^tsconfig\\.json$|^package(-lock)?\\.json$";
      pass_filenames = false;
    };
    # Offline and quick. The bridge gate talks to Claude Code, so it stays manual.
    vitest = {
      enable = true;
      name = "vitest";
      entry = "npm test";
      files = "\\.ts$|^package(-lock)?\\.json$";
      pass_filenames = false;
    };
  };

  enterTest = ''
    npm run check
    npm run build
    npm test
  '';
}
