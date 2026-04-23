import cv2
import numpy as np

f = cv2.imread('scripts/_preview/ace_original_frame.png')

# Draw several candidate mask regions to find the right one
# Region A: original v1 mask (770, 100, 360, 420) - RED
cv2.rectangle(f, (770, 100), (770+360, 100+420), (0, 0, 255), 2)
cv2.putText(f, "A: v1", (770, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

# Region B: v3 mask (835, 140, 250, 280) - GREEN
cv2.rectangle(f, (835, 140), (835+250, 140+280), (0, 255, 0), 2)
cv2.putText(f, "B: v3", (835, 135), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

# Region C: tighter on visible logo box - BLUE
# Logo appears centered ~x=960, the dark panel is roughly 130x170
cx, cy = 960, 275
hw, hh = 80, 100
cv2.rectangle(f, (cx-hw, cy-hh), (cx+hw, cy+hh), (255, 0, 0), 2)
cv2.putText(f, "C: tight", (cx-hw, cy-hh-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 0), 1)

# Region D: generous around entire dark structure - YELLOW
cv2.rectangle(f, (860, 150), (1060, 390), (0, 255, 255), 2)
cv2.putText(f, "D: generous", (860, 145), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

cv2.imwrite('scripts/_preview/ace_mask_regions.png', f)
print("Saved mask region overlay to scripts/_preview/ace_mask_regions.png")
