#cloud-boothook
#!/bin/bash
# Used only on the stopped probe to recover its synthetic benchmark output.
shutdown -h +5
echo PARALI_RECOVERED_LOG_START > /dev/console
cat /var/log/parali-probe.log > /dev/console 2>&1
tail -c 5000 /var/log/parali-ollama.log > /dev/console 2>&1
tail -c 2000 /var/log/parali-model-pull.log > /dev/console 2>&1
echo PARALI_RECOVERED_LOG_END > /dev/console
