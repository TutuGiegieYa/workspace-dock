#!/usr/bin/env python3
"""Build the dependency-free extension from an explicit publishable file list."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

root = Path(__file__).resolve().parent.parent
package = json.loads((root / 'package.json').read_text())
namespace = 'http://schemas.microsoft.com/developer/vsx-schema/2011'
ET.register_namespace('', namespace)
tag = lambda name: '{' + namespace + '}' + name
manifest = ET.Element(tag('PackageManifest'), Version='2.0.0')
metadata = ET.SubElement(manifest, tag('Metadata'))
ET.SubElement(metadata, tag('Identity'), Language='en-US', Id=package['name'],
              Version=package['version'], Publisher=package['publisher'])
ET.SubElement(metadata, tag('DisplayName')).text = package['displayName']
ET.SubElement(metadata, tag('Description')).text = package['description']
ET.SubElement(metadata, tag('Tags')).text = ','.join(package['keywords'])
ET.SubElement(metadata, tag('Categories')).text = ','.join(package['categories'])
ET.SubElement(metadata, tag('GalleryFlags')).text = 'Public'
properties = ET.SubElement(metadata, tag('Properties'))
ET.SubElement(properties, tag('Property'), Id='Microsoft.VisualStudio.Code.Engine',
              Value=package['engines']['vscode'])
ET.SubElement(properties, tag('Property'), Id='Microsoft.VisualStudio.Services.Links.Source',
              Value=package['repository']['url'].removesuffix('.git'))
installation = ET.SubElement(manifest, tag('Installation'))
ET.SubElement(installation, tag('InstallationTarget'), Id='Microsoft.VisualStudio.Code')
ET.SubElement(manifest, tag('Dependencies'))
assets = ET.SubElement(manifest, tag('Assets'))
for kind, path in [('Microsoft.VisualStudio.Code.Manifest', 'package.json'),
                   ('Microsoft.VisualStudio.Services.Content.Details', 'README.md'),
                   ('Microsoft.VisualStudio.Services.Content.License', 'LICENSE'),
                   ('Microsoft.VisualStudio.Services.Content.Changelog', 'CHANGELOG.md')]:
    ET.SubElement(assets, tag('Asset'), Type=kind, Path='extension/' + path, Addressable='true')
content_types = b'''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="json" ContentType="application/json"/>
<Default Extension="js" ContentType="application/javascript"/>
<Default Extension="py" ContentType="text/x-python"/>
<Default Extension="md" ContentType="text/markdown"/>
<Default Extension="vsixmanifest" ContentType="text/xml"/>
<Override PartName="/extension/LICENSE" ContentType="text/plain"/>
</Types>'''
output = root / 'dist' / f"workspace-dock-{package['version']}.vsix"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('extension.vsixmanifest', ET.tostring(manifest, encoding='utf-8', xml_declaration=True))
    archive.writestr('[Content_Types].xml', content_types)
    for filename in ['package.json', 'extension.js', 'repository-status.js', 'codex-title.py', 'README.md', 'LICENSE', 'CHANGELOG.md']:
        archive.write(root / filename, 'extension/' + filename)
print(output)
