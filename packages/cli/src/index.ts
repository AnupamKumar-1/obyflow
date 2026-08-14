#!/usr/bin/env node
import { buildCli } from "./cli.js";

const program = buildCli();
program.parse(process.argv);