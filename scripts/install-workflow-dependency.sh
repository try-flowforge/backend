#!/bin/bash

# Install/Update dependencies for all workflows in the cre folder

cd src/services/cre/workflows

for workflow_dir in */; do
    echo "Installing dependencies for $workflow_dir"
    cd $workflow_dir
    bun install
    cd ..
done
