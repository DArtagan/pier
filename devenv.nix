{
  pkgs,
  ...
}:

{
  packages = [ pkgs.git ];

  languages = {
    nix.enable = true;
    # Pinned to the pi version nixpkgs ships (package.json); its node_modules come from npm.
    javascript = {
      enable = true;
      package = pkgs.nodejs_24;
      npm = {
        enable = true;
        install.enable = true;
      };
    };
  };

  git-hooks.hooks = {
    biome.enable = true;
    deadnix.enable = true;
    end-of-file-fixer.enable = true;
    nixfmt.enable = true;
    shellcheck.enable = true;
    statix.enable = true;
    trim-trailing-whitespace.enable = true;
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
    npm test
  '';
}
