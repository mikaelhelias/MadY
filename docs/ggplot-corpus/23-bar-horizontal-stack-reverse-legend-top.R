# ggplot2 reference: geom_bar — horizontal, reversed stack, legend on top
ggplot(mpg, aes(y = class)) +
 geom_bar(aes(fill = drv), position = position_stack(reverse = TRUE)) +
 theme(legend.position = "top")
